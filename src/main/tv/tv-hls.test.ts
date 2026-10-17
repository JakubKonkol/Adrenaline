import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PairingStatus, TvPlayback } from '@shared/contracts/tv';
import type { MediaProbe } from '@shared/domain/playback';
import { nullLogger } from '../logger';
import { MediaService } from '../media/media-service';
import { ProbeCache } from '../media/probe-cache';
import { type ProcessHandle, Transcoder } from '../media/transcoder';
import { openDatabase } from '../persistence/db';
import { JobsRepository } from '../persistence/repositories/jobs';
import { MediaRepository } from '../persistence/repositories/media';
import { SubtitlesRepository } from '../persistence/repositories/subtitles';
import type { CatalogService } from '../services/catalog-service';
import { LibraryService } from '../services/library-service';
import type { ReleaseSearchService } from '../services/release-search-service';
import { SettingsService } from '../services/settings-service';
import { TvDevicesRepository } from './devices';
import { TvService } from './tv-service';
import { PROFILE } from '../../../tests/helpers/tv-profile';
import { freePort } from '../../../tests/helpers/free-port';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** MKV with H.264 + AAC: the 1080p SDR profile needs a remux to HLS. */
const probe: MediaProbe = {
  container: 'mkv',
  durationMs: 600_000,
  bitrate: 4_000_000,
  sizeBytes: 10,
  video: {
    index: 0,
    codec: 'h264',
    profile: 'High',
    level: 41,
    width: 1920,
    height: 1080,
    bitDepth: 8,
    frameRate: 24,
    hdr: 'sdr',
    hdr10plus: false,
    dolbyVision: null,
  },
  audio: [
    {
      index: 1,
      codec: 'aac',
      profile: 'LC',
      channels: 2,
      language: 'eng',
      title: null,
      isDefault: true,
      atmos: false,
      dtsHd: false,
    },
  ],
  subtitles: [],
};

async function setup() {
  const base = mkdtempSync(join(tmpdir(), 'adr-hls-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const db = openDatabase(':memory:', { log: nullLogger });
  cleanups.push(() => db.close());
  const settings = new SettingsService(db, { downloadDir: join(base, 'Videos'), randomPort: () => 50000 });
  const jobs = new JobsRepository(db);
  const saveDir = join(base, 'Videos', 'film');
  mkdirSync(saveDir, { recursive: true });
  writeFileSync(join(saveDir, 'Film.mkv'), '0123456789');
  jobs.insert({
    id: 'job1',
    mediaItemId: null,
    episodeId: null,
    target: { kind: 'movie', tmdbId: 1, title: 'Film', originalTitle: 'Film', year: 2020 },
    release: { name: 'Film', sources: ['x'], size: 10, suggestedFiles: [] },
    sourceKind: 'magnet',
    magnet: null,
    torrent: null,
    infoHashV1: 'a'.repeat(40),
    infoHashV2: null,
    saveDir,
    state: 'completed',
    pauseReason: null,
    resumeState: null,
    errorCode: null,
    errorMessage: null,
    totalBytes: 10,
    doneBytes: 10,
    seedRatioLimit: null,
    seedTimeLimitMin: null,
    subtitleLang: null,
    subtitleFallbackLang: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: 1,
  });
  jobs.replaceFiles('job1', [{ index: 0, relPath: 'Film.mkv', size: 10, selected: true, doneBytes: 10 }]);
  const media = new MediaRepository(db);
  const library = new LibraryService({
    jobs,
    subtitles: new SubtitlesRepository(db),
    media,
    removeJob: () => Promise.resolve(),
  });
  // FFmpeg stand-in: finishes two segments from its start number (listed like the segment muxer), runs until killed.
  const killed: string[] = [];
  const starts: number[] = [];
  const spawn = (args: string[], cwd: string): ProcessHandle => {
    const from = Number(args[args.indexOf('-segment_start_number') + 1]);
    starts.push(from);
    for (const n of [from, from + 1]) {
      const name = `seg${String(n).padStart(5, '0')}.ts`;
      writeFileSync(join(cwd, name), `segment-${n}`);
      appendFileSync(join(cwd, 'ffmpeg.csv'), `${name},${n * 6},${n * 6 + 6}\n`);
    }
    let exit: ((code: number | null) => void) | null = null;
    return {
      pid: 1,
      onExit: (l) => void (exit = l),
      onProgress: () => undefined,
      kill: () => {
        killed.push(cwd);
        exit?.(null);
      },
    };
  };
  const transcoder = new Transcoder({
    cacheDir: join(base, 'transcode'),
    spawn,
    runFfmpeg: () => Promise.resolve(),
    log: nullLogger,
    cacheLimitBytes: () => 1e9,
  });
  const playback = new MediaService({
    library,
    settings,
    cache: new ProbeCache(db),
    tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
    detector: null,
    transcoder,
    log: nullLogger,
    probe: () => Promise.resolve(probe),
  });
  const port = await freePort();
  const tv = new TvService({
    version: 't',
    devices: new TvDevicesRepository(db),
    catalog: {} as CatalogService,
    releases: {} as ReleaseSearchService,
    downloads: () => null,
    library,
    media,
    settings,
    playback,
    subtitleAccountReady: () => false,
    log: nullLogger,
    addresses: () => [{ address: '127.0.0.1', interfaceName: 'lo', private: true }],
  });
  cleanups.push(() => tv.stop());
  settings.update({ tvServerEnabled: true, tvServerPort: port });
  await tv.apply();
  const url = `http://127.0.0.1:${port}`;
  const pair = async (name: string) => {
    const created = (await (
      await fetch(`${url}/api/v1/pairings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName: name, platform: 'tizen' }),
      })
    ).json()) as { pairingId: string; claimSecret: string };
    tv.approve(tv.status().pending.find((p) => p.deviceName === name)!.id);
    const claimed = (await (
      await fetch(`${url}/api/v1/pairings/${created.pairingId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimSecret: created.claimSecret }),
      })
    ).json()) as PairingStatus;
    if (claimed.status !== 'approved') throw new Error('not approved');
    return claimed;
  };
  const play = async (token: string, startMs = 0) =>
    (await (
      await fetch(`${url}/api/v1/playback/job1~0`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: PROFILE, startMs }),
      })
    ).json()) as TvPlayback;
  return { tv, url, pair, play, transcoder, killed, starts };
}

describe('HLS delivery (D-85)', () => {
  it('serves playlist and segments only with the ticket of the TV that started the session', async () => {
    const { tv, pair, play, transcoder, killed, starts } = await setup();
    const a = await pair('Living room');
    const b = await pair('Bedroom');
    const pa = await play(a.token);
    expect(pa).toMatchObject({
      mode: 'remux',
      mimeType: 'application/vnd.apple.mpegurl',
      durationMs: 600_000,
    });
    expect(pa.streamUrl).toMatch(/\/media\/[\w-]+\/hls\/[0-9a-f]{24}\/index\.m3u8$/);
    const playlist = await fetch(pa.streamUrl);
    expect(playlist.status).toBe(200);
    expect(playlist.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    // One VOD playlist for the whole film (10 minutes = 100 segments of 6 s), as Jellyfin.
    const text = await playlist.text();
    expect(text).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(text).toContain('seg00099.ts');
    expect(text).not.toContain('seg00100.ts');
    expect(text.trimEnd().endsWith('#EXT-X-ENDLIST')).toBe(true);
    const segment = pa.streamUrl.replace('index.m3u8', 'seg00000.ts');
    const segmentResponse = await fetch(segment);
    expect(segmentResponse.headers.get('content-type')).toBe('video/mp2t');
    expect(await segmentResponse.text()).toBe('segment-0');
    // A seek far ahead: FFmpeg starts again at that segment; the next one comes from the same run.
    expect(await (await fetch(pa.streamUrl.replace('index.m3u8', 'seg00050.ts'))).text()).toBe('segment-50');
    expect(await (await fetch(pa.streamUrl.replace('index.m3u8', 'seg00051.ts'))).text()).toBe('segment-51');
    expect(starts).toEqual([0, 50]);
    // Beyond the end of the film or another format: not found.
    expect((await fetch(pa.streamUrl.replace('index.m3u8', 'seg00100.ts'))).status).toBe(404);
    // Names outside the allowlist and traversal never reach the disk.
    for (const bad of ['..%2F..%2Fsecret', 'seg1.ts', 'seg00001.m4s', 'init.mp4', 'seg00000.tsx', 'index.m3u8.bak'])
      expect((await fetch(pa.streamUrl.replace('index.m3u8', bad))).status).toBe(400);

    // Another TV's ticket cannot read this session.
    const pb = await play(b.token);
    const sessionA = /hls\/([0-9a-f]{24})\//.exec(pa.streamUrl)![1]!;
    const crossed = pb.streamUrl.replace(/hls\/[0-9a-f]{24}\//, `hls/${sessionA}/`);
    expect((await fetch(crossed)).status).toBe(404);

    // A new playback (e.g. another audio track from 2:02.5) replaces the session; FFmpeg starts at that segment.
    const seek = await play(a.token, 122_500);
    expect(starts.at(-1)).toBe(20);
    expect(seek.streamUrl).not.toBe(pa.streamUrl);
    expect(transcoder.list().filter((s) => s.deviceId === a.deviceId)).toHaveLength(1);
    expect((await fetch(segment)).status).toBe(404); // the old session is gone
    expect(killed.length).toBe(2); // the run from 0 (seek) and the run from 50 (new playback)

    // Revoke: the TV's conversion stops and its URLs die.
    tv.revoke(a.deviceId);
    expect(transcoder.list().some((s) => s.deviceId === a.deviceId)).toBe(false);
    expect((await fetch(seek.streamUrl)).status).toBe(401);
    expect(tv.status().playbacks.map((p) => p.mode)).toContain('remux');
  });
});
