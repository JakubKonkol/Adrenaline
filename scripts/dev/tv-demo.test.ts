/**
 * Manual TV demo server (not part of `npm test`): the real TV API on 127.0.0.1:18790 with a synthetic catalog,
 * a fake engine and a few finished films in the library, pairing approved automatically.
 *
 *   npx vitest run -c scripts/dev/vitest.tv-demo.config.ts     # keeps running (Ctrl+C to stop)
 *   npm run dev:tv                                              # then open http://localhost:5174/?server=127.0.0.1:18790
 *
 * Optional: ffmpeg in PATH makes the library a playable test matrix of formats (clips cached in TV_DEMO_CLIPS).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { FakeJackett } from '../../tests/helpers/fake-jackett';
import { EngineSupervisor } from '../../src/main/engine/engine-process';
import { FakeEngine } from '../../src/main/engine/fake-engine';
import { createFileLogger } from '../../src/main/logger';
import { openDatabase } from '../../src/main/persistence/db';
import { CacheRepository } from '../../src/main/persistence/repositories/cache';
import { type JobRow, JobsRepository } from '../../src/main/persistence/repositories/jobs';
import { MediaRepository } from '../../src/main/persistence/repositories/media';
import { SubtitlesRepository } from '../../src/main/persistence/repositories/subtitles';
import { TmdbClient } from '../../src/main/providers/tmdb/tmdb-client';
import { TorznabClient, type TorznabSource } from '../../src/main/providers/torznab/torznab-client';
import { CatalogService } from '../../src/main/services/catalog-service';
import { DownloadService } from '../../src/main/services/download-service';
import { LibraryService } from '../../src/main/services/library-service';
import { ReleaseSearchService } from '../../src/main/services/release-search-service';
import { SettingsService } from '../../src/main/services/settings-service';
import type { SourcesService } from '../../src/main/services/sources-service';
import { TvDevicesRepository } from '../../src/main/tv/devices';
import { TvService } from '../../src/main/tv/tv-service';
import { DeployService } from '../../src/main/tv/deploy/deploy-service';
import { listAddresses } from '../../src/main/tv/network';
import { resolveFfmpeg } from '../../src/main/media/ffmpeg-path';
import { createMediaService } from '../../src/main/media/media-service';

const MiB = 1024 * 1024;
// Synthetic titles (own data, D-23): images are served by the screenshot script from generated files.
const MOVIES = [
  ['Northern Lights', 2024, 'A night pilot chases a storm across the Arctic and finds something older than the ice.'],
  ['The Long Signal', 2023, 'A radio engineer receives a message that was sent forty years from now.'],
  ['Copper Coast', 2022, 'Two sisters inherit a failing hotel on a coast that keeps moving.'],
  ['Glass Harbor', 2024, 'A detective story set in a city built entirely on water.'],
  ['Last Train South', 2021, 'Strangers on an overnight train share one secret each before dawn.'],
  ['Paper Moons', 2023, 'An animator brings her late father’s sketches to life.'],
  ['Saltwind', 2022, 'A sailing race around the world turns into a rescue mission.'],
  ['Quiet Hours', 2024, 'A night-shift nurse and a sleepless patient solve a hospital mystery.'],
] as const;
const SHOWS = [
  ['Orbit Station', 2022, 'Life and trouble aboard the last commercial space station.'],
  ['The Archivists', 2023, 'Librarians who restore lost films uncover a forgotten studio.'],
  ['Midnight Kitchen', 2021, 'A tiny restaurant that opens only after midnight.'],
  ['Fieldwork', 2024, 'Geologists on a remote island document a volcano waking up.'],
] as const;

const movieRow = (i: number) => {
  const [title, year, overview] = MOVIES[i]!;
  return {
    id: 1000 + i,
    title,
    original_title: title,
    release_date: `${year}-05-0${(i % 8) + 1}`,
    poster_path: `/demo-poster-m${i}.jpg`,
    backdrop_path: `/demo-backdrop-m${i}.jpg`,
    overview,
    popularity: 100 - i,
  };
};
const showRow = (i: number) => {
  const [name, year, overview] = SHOWS[i]!;
  return {
    id: 2000 + i,
    name,
    original_name: name,
    first_air_date: `${year}-09-1${i}`,
    poster_path: `/demo-poster-s${i}.jpg`,
    backdrop_path: `/demo-backdrop-s${i}.jpg`,
    overview,
    popularity: 90 - i,
  };
};

function tmdb(url: URL): unknown {
  const p = url.pathname.replace('/3/', '');
  if (p === 'trending/movie/week' || p === 'search/movie')
    return { results: MOVIES.map((_, i) => movieRow(i)).filter((m) => matches(m.title, url)) };
  if (p === 'trending/tv/week' || p === 'search/tv')
    return { results: SHOWS.map((_, i) => showRow(i)).filter((s) => matches(s.name, url)) };
  const movie = /^movie\/(\d+)$/.exec(p);
  if (movie)
    return {
      ...movieRow(Number(movie[1]) - 1000),
      genres: [
        { id: 1, name: 'Drama' },
        { id: 2, name: 'Mystery' },
      ],
      runtime: 118,
      external_ids: { imdb_id: null },
    };
  const show = /^tv\/(\d+)$/.exec(p);
  if (show)
    return {
      ...showRow(Number(show[1]) - 2000),
      genres: [{ id: 3, name: 'Sci-Fi & Fantasy' }],
      episode_run_time: [45],
      external_ids: { imdb_id: null },
      seasons: [
        { season_number: 1, name: 'Season 1', episode_count: 8 },
        { season_number: 2, name: 'Season 2', episode_count: 6 },
      ],
    };
  const season = /^tv\/(\d+)\/season\/(\d+)$/.exec(p);
  if (season) {
    const n = Number(season[2]);
    return {
      id: 9000 + n,
      season_number: n,
      name: `Season ${n}`,
      episodes: Array.from({ length: n === 1 ? 8 : 6 }, (_, i) => ({
        id: 90000 + n * 100 + i,
        episode_number: i + 1,
        season_number: n,
        name: ['Arrival', 'Drift', 'The Signal', 'Pressure', 'Blackout', 'Crossing', 'Echoes', 'Homecoming'][i]!,
        air_date: '2022-09-01',
        overview: 'The crew faces a new problem that nobody on board has seen before.',
      })),
    };
  }
  return {};
}

function matches(title: string, url: URL): boolean {
  const q = url.searchParams.get('query');
  return !q || title.toLowerCase().includes(q.toLowerCase());
}

const releases = (title: string) => {
  const base = title.replace(/[^A-Za-z0-9]+/g, '.');
  const items = [
    [`${base}.2160p.WEB-DL.DV.HDR.DDP5.1.Atmos.H.265-DEMO`, 18_400, 412],
    [`${base}.1080p.BluRay.x264.DTS-HD.MA.5.1-DEMO`, 11_200, 268],
    [`${base}.1080p.WEB-DL.DDP5.1.H.264-DEMO`, 4_300, 155],
    [`${base}.720p.WEBRip.x264.AAC-DEMO`, 1_400, 74],
  ] as const;
  return `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${items
    .map(([name, mb, seeders], i) => {
      const hash = `${(title.length + i).toString(16)}${'0'.repeat(39)}`.slice(0, 40).replace(/^./, String(i));
      return `<item><title>${name}</title><guid>${hash}</guid><size>${mb * MiB}</size>
<torznab:attr name="seeders" value="${seeders}" /><torznab:attr name="infohash" value="${hash}" />
<torznab:attr name="magneturl" value="magnet:?xt=urn:btih:${hash}&amp;dn=${name}" /></item>`;
    })
    .join('')}</channel></rss>`;
};

it('serves the TV demo', async () => {
  const base = mkdtempSync(join(tmpdir(), 'adr-tv-demo-'));
  const log = createFileLogger({ dir: join(base, 'logs'), homeDir: base, mirror: true });
  const db = openDatabase(join(base, 'demo.db'), { log });
  const settings = new SettingsService(db, { downloadDir: join(base, 'Videos'), randomPort: () => 50000 });
  const media = new MediaRepository(db);
  const catalog = new CatalogService(
    new TmdbClient({
      token: () => 'demo',
      fetch: (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(new Response(JSON.stringify(tmdb(url))));
      },
    }),
    new CacheRepository(db),
    media,
  );
  let lastTitle = 'Demo';
  const releaseSearch = new ReleaseSearchService({
    sources: {
      searchable: () =>
        Promise.resolve({
          sources: ['Demo A', 'Demo B'].map((name, i): TorznabSource => ({
            id: `s${i}`,
            name,
            endpoint: `http://s${i}/api`,
            apiKey: () => 'k',
          })),
          failed: [],
        }),
      recordHealth: () => undefined,
    } as unknown as SourcesService,
    torznab: new TorznabClient({
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.searchParams.get('t') === 'caps') return new Response(FakeJackett.fixture('caps.xml'));
        await new Promise((r) => setTimeout(r, url.hostname === 's0' ? 600 : 1500));
        return new Response(releases(lastTitle));
      },
    }),
    cache: new CacheRepository(db),
    log,
  });
  releaseSearch.on('update', (s) => (lastTitle = s.target.title));
  const fake = new FakeEngine({
    tickMs: 500,
    rate: 3 * MiB,
    files: (name) => [{ path: `${name}/${name}.mkv`, size: 900 * MiB, pad: false }],
  });
  const engine = new EngineSupervisor({ launch: fake.launch, log, clientVersion: 'demo' });
  const jobs = new JobsRepository(db);
  const subtitles = new SubtitlesRepository(db);
  const downloads = new DownloadService({
    jobs,
    engine,
    settings,
    releaseInfo: (s, r) => releaseSearch.downloadInfo(s, r),
    endpointFor: () => Promise.resolve(null),
    log,
  });
  await engine.start();
  const library = new LibraryService({ jobs, subtitles, media, removeJob: (id, del) => downloads.remove(id, del) });

  // Library: a test matrix of formats (D-85), real clips made once with ffmpeg from PATH and kept in TV_DEMO_CLIPS.
  // Every frame shows its film time and every subtitle cue says when it should appear, so seeking and subtitle sync
  // can be checked by eye on the TV.
  const clipsDir = process.env['TV_DEMO_CLIPS'] ?? join(tmpdir(), 'adr-tv-demo-clips-v2');
  mkdirSync(clipsDir, { recursive: true });
  const cues = (seconds: number, lang: string) =>
    Array.from({ length: Math.floor(seconds / 10) }, (_, i) => {
      const t = (i + 1) * 10;
      const at = (x: number) =>
        `00:${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')},000`;
      return `${i + 1}\n${at(t)} --> ${at(t + 4)}\n[${lang}] cue at ${at(t).slice(3, 8)} — zażółć gęślą jaźń\n`;
    }).join('\n');
  const video = (size: string, seconds: number, rate = 25) =>
    `testsrc2=size=${size}:rate=${rate}:duration=${seconds},drawtext=text='%{pts\\:hms}':fontsize=96:fontcolor=white:box=1:boxcolor=black@0.6:x=80:y=80`;
  const tone = (seconds: number) => `sine=frequency=330:duration=${seconds}`;
  interface Clip {
    target: JobRow['target'];
    ext: string;
    seconds: number;
    /** ffmpeg arguments after the lavfi inputs [0] video, [1] audio and [2] an SRT file. */
    args: string[];
    embedSubtitles?: boolean;
  }
  const movie = (i: number) => ({ kind: 'movie' as const, tmdbId: 1000 + i, title: '', originalTitle: '', year: null });
  const ep = (show: number, e: number) => ({
    kind: 'episode' as const,
    tmdbId: 2000 + show,
    title: '',
    originalTitle: '',
    year: null,
    season: 1,
    episode: e,
  });
  const hdr10 = ['-x265-params', 'hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:log-level=error'];
  const clips: Record<string, Clip> = {
    // Direct play everywhere.
    'h264-aac.mp4': {
      target: movie(1),
      ext: 'mp4',
      seconds: 90,
      args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
    },
    // 4K HEVC Main10 HDR10 + TrueHD 5.1 + embedded SRT: audio conversion, HLS (MPEG-TS on Samsung).
    'hevc10-hdr10-truehd.mkv': {
      target: movie(6),
      ext: 'mkv',
      seconds: 60,
      args: [
        '-c:v',
        'libx265',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p10le',
        ...hdr10,
        '-c:a',
        'truehd',
        '-strict',
        '-2',
        '-ac',
        '6',
      ],
      embedSubtitles: true,
    },
    // H.264 + DTS 5.1 + embedded SRT: DTS is converted for Samsung.
    'h264-dts.mkv': {
      target: movie(0),
      ext: 'mkv',
      seconds: 90,
      args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'dca', '-strict', '-2', '-ac', '6'],
      embedSubtitles: true,
    },
    // XviD + MP3 in AVI: video encode.
    'xvid-mp3.avi': {
      target: movie(2),
      ext: 'avi',
      seconds: 90,
      args: ['-c:v', 'libxvid', '-q:v', '4', '-c:a', 'libmp3lame'],
    },
    // H.264 High 10 + AC3 5.1: 10-bit H.264 is not decoded by TVs → video encode.
    'h264-10bit-ac3.mkv': {
      target: movie(3),
      ext: 'mkv',
      seconds: 90,
      args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-c:a', 'ac3', '-ac', '6'],
    },
    // VP9 + Opus in WebM: direct play.
    'vp9-opus.webm': {
      target: movie(4),
      ext: 'webm',
      seconds: 60,
      args: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '3M', '-c:a', 'libopus'],
    },
    // AV1 10-bit + Opus in MKV: direct play on 4K Samsungs from 2021.
    'av1-opus.mkv': {
      target: movie(5),
      ext: 'mkv',
      seconds: 60,
      args: ['-c:v', 'libsvtav1', '-preset', '12', '-pix_fmt', 'yuv420p10le', '-c:a', 'libopus'],
    },
    // HEVC 8-bit + FLAC 5.1: FLAC is converted on Samsung (audio delay in direct play).
    'hevc-flac.mkv': {
      target: movie(7),
      ext: 'mkv',
      seconds: 90,
      args: [
        '-c:v',
        'libx265',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-x265-params',
        'log-level=error',
        '-c:a',
        'flac',
        '-ac',
        '6',
      ],
    },
    // MPEG-2 + MP2 in MPEG-TS (DVB recording): direct play.
    'mpeg2-mp2.ts': {
      target: ep(0, 1),
      ext: 'ts',
      seconds: 90,
      args: ['-c:v', 'mpeg2video', '-b:v', '8M', '-c:a', 'mp2'],
    },
    // H.264 + E-AC3 5.1 in MP4: direct play, Dolby passthrough.
    'h264-eac3.mp4': {
      target: ep(0, 2),
      ext: 'mp4',
      seconds: 90,
      args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'eac3', '-ac', '6'],
    },
    // 4K HEVC Main10 HDR10 + E-AC3 in MP4: HDR direct play.
    'hevc10-hdr10-eac3.mp4': {
      target: ep(2, 1),
      ext: 'mp4',
      seconds: 60,
      args: [
        '-c:v',
        'libx265',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p10le',
        ...hdr10,
        '-tag:v',
        'hvc1',
        '-c:a',
        'eac3',
        '-ac',
        '6',
      ],
    },
    // H.264 + PCM in MOV: container remux and PCM conversion.
    'h264-pcm.mov': {
      target: ep(1, 1),
      ext: 'mov',
      seconds: 90,
      args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le'],
    },
  };
  const clipFor = (name: string, clip: Clip): string | null => {
    const out = join(clipsDir, name);
    if (existsSync(out)) return out;
    const size = clip.args.includes('yuv420p10le') && name.includes('hdr') ? '3840x2160' : '1920x1080';
    const srt = join(clipsDir, `${name}.srt`);
    writeFileSync(srt, cues(clip.seconds, 'embedded'));
    try {
      execFileSync('ffmpeg', [
        ...[
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          video(size, clip.seconds),
          '-f',
          'lavfi',
          '-i',
          tone(clip.seconds),
        ],
        ...(clip.embedSubtitles
          ? ['-i', srt, '-map', '0', '-map', '1', '-map', '2', '-c:s', 'srt', '-metadata:s:s:0', 'language=pol']
          : []),
        ...clip.args,
        ...['-shortest', `${out}.part.${clip.ext}`],
      ]);
      renameSync(`${out}.part.${clip.ext}`, out);
      return out;
    } catch (error) {
      console.warn(`demo clip ${name} could not be made`, error);
      return null;
    }
  };

  let n = 0;
  for (const [name, clip] of Object.entries(clips)) {
    n++;
    const source = clipFor(name, clip);
    const target = clip.target;
    const title = await catalog.select(
      target.kind === 'movie'
        ? { type: 'movie', tmdbId: target.tmdbId }
        : { type: 'tv', tmdbId: target.tmdbId, season: target.season, episode: target.episode },
    );
    const dir = join(base, 'Videos', `demo${n}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${title.title.replace(/\W+/g, '.')}.${name.replace(/\.\w+$/, '')}.${clip.ext}`);
    if (source) copyFileSync(source, file);
    else writeFileSync(file, Buffer.alloc(1024));
    const srt = file.replace(/\.\w+$/, '.en.srt');
    writeFileSync(srt, cues(clip.seconds, 'external'));
    const id = `demo-${n}`;
    jobs.insert({
      id,
      mediaItemId: null,
      episodeId: null,
      target: title,
      release: { name: `Demo.Release.${name}`, sources: ['Demo'], size: 1, suggestedFiles: [] },
      sourceKind: 'magnet',
      magnet: null,
      torrent: null,
      infoHashV1: `${n}`.padStart(40, 'f'),
      infoHashV2: null,
      saveDir: dir,
      state: 'completed',
      pauseReason: null,
      resumeState: null,
      errorCode: null,
      errorMessage: null,
      totalBytes: 1,
      doneBytes: 1,
      seedRatioLimit: null,
      seedTimeLimitMin: null,
      subtitleLang: 'en',
      subtitleFallbackLang: null,
      createdAt: n,
      updatedAt: n,
      completedAt: Date.now() - n * 3600_000,
    });
    jobs.replaceFiles(id, [{ index: 0, relPath: file.slice(dir.length + 1), size: 1, selected: true, doneBytes: 1 }]);
    const task = subtitles.ensure(id, 0, 'en');
    subtitles.update(task.id, { state: 'ready', targetPath: srt });
  }
  // Real sizes for the files (the rows above store 1 byte to keep the insert simple).
  for (const j of jobs.active()) {
    const f = jobs.files(j.id)[0]!;
    const { size } = await import('node:fs').then((fs) => fs.statSync(join(j.saveDir, f.relPath)));
    jobs.replaceFiles(j.id, [{ ...f, size, doneBytes: size }]);
  }

  const playback = createMediaService({
    userData: base,
    db,
    library,
    settings,
    tools: resolveFfmpeg({ env: process.env, isPackaged: false, resourcesPath: '', appRoot: process.cwd() }),
    log: log,
  });
  const tv = new TvService({
    playback,
    version: 'demo',
    devices: new TvDevicesRepository(db),
    catalog,
    releases: releaseSearch,
    downloads: () => downloads,
    library,
    media,
    settings,
    subtitleAccountReady: () => true,
    log,
    // TV_DEMO_LAN=1: listen on the LAN address (Android emulator / real TVs), otherwise loopback only.
    addresses: () =>
      process.env['TV_DEMO_LAN']
        ? listAddresses()
        : [{ address: '127.0.0.1', interfaceName: 'loopback', private: true }],
  });
  tv.pairing.on('changed', () => {
    for (const p of tv.pairing.pending()) {
      if (process.env['TV_TIZEN_ADDRESS'] && p.address !== process.env['TV_TIZEN_ADDRESS']) continue;
      setTimeout(() => tv.approve(p.id), 1500);
    }
  });
  settings.update({ tvServerEnabled: true, tvServerPort: 18790 });
  await tv.apply();
  console.log(`TV demo ready: ${tv.status().url} (data in ${base})`);
  // Explicit opt-in only: install on the named physical Samsung, using the real authenticated handshake.
  // Keep the author in the desktop profile so a subsequent desktop installation can update this widget.
  if (process.env['TV_TIZEN_ADDRESS']) {
    if (!process.env['APPDATA']) throw new Error('APPDATA required to preserve the author identity');
    const deploy = new DeployService({
      tvDir: join(process.cwd(), 'resources/tv'),
      workDir: join(process.env['APPDATA'], 'adrenaline/tv-deploy'),
      toolchain: () => ({ adb: null, sdb: null, tizen: null, tizenStudio: null, profiles: [] }),
      serverUrl: () => tv.status().url,
      waitForTv: (address, since, signal) => tv.waitForTv(address, since, signal),
      log,
    });
    deploy.on('state', (s) =>
      console.log(`Samsung deploy: ${s.step} ${s.status} ${s.errorCode ?? ''} ${s.detail ?? ''}`),
    );
    deploy.start({ platform: 'tizen', address: process.env['TV_TIZEN_ADDRESS'], profile: '' });
  }
  await new Promise(() => undefined);
});
