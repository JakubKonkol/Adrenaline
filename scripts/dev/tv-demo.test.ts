/**
 * Manual TV demo server (not part of `npm test`): the real TV API on 127.0.0.1:18790 with a synthetic catalog,
 * a fake engine and a few finished films in the library, pairing approved automatically.
 *
 *   npx vitest run -c scripts/dev/vitest.tv-demo.config.ts     # keeps running (Ctrl+C to stop)
 *   npm run dev:tv                                              # then open http://localhost:5174/?server=127.0.0.1:18790
 *
 * Optional: ffmpeg in PATH makes the library films real, playable 20-second clips.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

  // Library: two films and three episodes, finished (real clips when ffmpeg is available).
  const finished = async (target: JobRow['target'], n: number) => {
    const title = await catalog.select(
      target.kind === 'movie'
        ? { type: 'movie', tmdbId: target.tmdbId }
        : { type: 'tv', tmdbId: target.tmdbId, season: target.season, episode: target.episode },
    );
    const dir = join(base, 'Videos', `demo${n}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${title.title.replace(/\W+/g, '.')}.mp4`);
    try {
      execFileSync('ffmpeg', [
        ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=25:duration=20`],
        ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20'],
        ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file],
      ]);
    } catch {
      writeFileSync(file, Buffer.alloc(1024));
    }
    const srt = file.replace(/\.mp4$/, '.en.srt');
    writeFileSync(
      srt,
      '1\n00:00:01,000 --> 00:00:06,000\nThis is a demo subtitle.\n\n2\n00:00:07,000 --> 00:00:12,000\nZażółć gęślą jaźń — Polish letters work.\n',
    );
    const id = `demo-${n}`;
    jobs.insert({
      id,
      mediaItemId: null,
      episodeId: null,
      target: title,
      release: { name: `Demo.Release.${n}`, sources: ['Demo'], size: 1, suggestedFiles: [] },
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
  };
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
  await finished(movie(1), 1);
  await finished(movie(4), 2);
  await finished(ep(0, 1), 3);
  await finished(ep(0, 2), 4);
  await finished(ep(2, 1), 5);
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
    addresses: () => [{ address: '127.0.0.1', interfaceName: 'loopback', private: true }],
  });
  tv.pairing.on('changed', () => {
    for (const p of tv.pairing.pending()) setTimeout(() => tv.approve(p.id), 1500);
  });
  settings.update({ tvServerEnabled: true, tvServerPort: 18790 });
  await tv.apply();
  console.log(`TV demo ready: ${tv.status().url} (data in ${base})`);
  await new Promise(() => undefined);
});
