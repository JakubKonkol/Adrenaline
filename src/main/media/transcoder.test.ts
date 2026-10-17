import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlaybackPlan } from '@shared/domain/playback';
import { nullLogger } from '../logger';
import { buildHlsArgs, SEGMENT_LIST, segmentName, vodPlaylist } from './ffmpeg-args';
import { segmentStarts } from './keyframes';
import { type ProcessHandle, type TranscodeSession, Transcoder } from './transcoder';

const plan = (over: Partial<PlaybackPlan> = {}): PlaybackPlan => ({
  mode: 'audio',
  delivery: 'hls',
  video: {
    index: 0,
    action: 'copy',
    codec: 'hevc',
    encoder: null,
    toneMap: 'none',
    width: 3840,
    height: 2160,
    bitrateKbps: null,
  },
  audio: { index: 1, action: 'encode', codec: 'eac3', channels: 6, bitrateKbps: 640 },
  subtitles: { delivery: 'none', index: null, lang: null },
  reasons: [],
  error: null,
  ...over,
});

interface Run {
  from: number;
  args: string[];
  killed: boolean;
  exit: (code: number | null) => void;
  /** Writes the next segments and lists them as finished (like the segment muxer). */
  write: (count: number) => void;
  /** Writes the next segment without finishing it. */
  partial: () => void;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** Transcoder with a fake FFmpeg (the test writes its segments) and a clock the test moves. */
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'adr-transcoder-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  let clock = 1_000_000;
  const runs: Run[] = [];
  const transcoder = new Transcoder({
    cacheDir: join(base, 'transcode'),
    log: nullLogger,
    runFfmpeg: () => Promise.resolve(),
    cacheLimitBytes: () => 1e12,
    now: () => clock,
    spawn: (args, cwd): ProcessHandle => {
      const from = Number(args[args.indexOf('-segment_start_number') + 1]);
      const exits: ((code: number | null) => void)[] = [];
      let next = from;
      const run: Run = {
        from,
        args,
        killed: false,
        exit: (code) => exits.forEach((l) => l(code)),
        write: (count) => {
          for (let i = 0; i < count; i++, next++) {
            writeFileSync(join(cwd, segmentName(next)), 'x');
            appendFileSync(join(cwd, SEGMENT_LIST), `${segmentName(next)},${next * 6}.0,${next * 6 + 6}.0\n`);
          }
        },
        partial: () => writeFileSync(join(cwd, segmentName(next)), 'half'),
      };
      runs.push(run);
      return {
        pid: runs.length,
        onExit: (l) => void exits.push(l),
        onProgress: () => undefined,
        kill: () => {
          run.killed = true;
          run.exit(null);
        },
      };
    },
  });
  cleanups.push(() => transcoder.stopAll());
  const start = (startMs = 0, durationMs = 2 * 60 * 60_000) =>
    transcoder.start({
      deviceId: 'tv',
      itemId: 'i~0',
      input: 'film.mkv',
      plan: plan(),
      durationMs,
      starts: segmentStarts(durationMs, 6000, null),
      startMs,
    });
  const get = (s: TranscodeSession, n: number) => transcoder.file(s, segmentName(n), 3_000);
  const tick = (ms: number) => (clock += ms);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { transcoder, runs, start, get, tick, settle };
}

describe('Transcoder (VOD HLS, Jellyfin style)', () => {
  it('builds a VOD playlist from the segment starts and FFmpeg arguments that cut exactly there', () => {
    const starts = [0, 7000, 14_000, 21_000];
    const playlist = vodPlaylist(24_500, starts);
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(playlist).toContain('#EXT-X-TARGETDURATION:7');
    expect(playlist.match(/#EXTINF:([\d.]+),/g)).toEqual([
      '#EXTINF:7.000000,',
      '#EXTINF:7.000000,',
      '#EXTINF:7.000000,',
      '#EXTINF:3.500000,',
    ]);
    expect(playlist.trimEnd().endsWith('#EXT-X-ENDLIST')).toBe(true);

    const copy = buildHlsArgs({
      plan: plan(),
      input: 'film.mkv',
      starts,
      startSegment: 1,
      imageSubtitleIndex: null,
      textSubtitleFile: false,
    });
    const value = (args: string[], name: string) => args[args.indexOf(name) + 1];
    // A copy seeks just past its segment's keyframe; the cuts follow relative to that start.
    expect(value(copy, '-ss')).toBe('7.500');
    expect(value(copy, '-segment_times')).toBe('7.000,14.000');
    expect(value(copy, '-segment_start_number')).toBe('1');
    expect(copy).toEqual(expect.arrayContaining(['-copyts', '-start_at_zero', 'mpegts', 'seg%05d.ts']));
    const encode = buildHlsArgs({
      plan: plan({
        mode: 'video',
        video: { ...plan().video, action: 'encode', codec: 'h264', encoder: 'libx264', bitrateKbps: 8000 },
      }),
      input: 'film.mkv',
      starts: segmentStarts(600_000, 6000, null),
      startSegment: 10,
      imageSubtitleIndex: null,
      textSubtitleFile: true,
    });
    expect(value(encode, '-ss')).toBe('60.000');
    // Keyframes on the segment grid (t counts from this run's start), subtitles in film time.
    expect(encode).toContain('expr:gte(t,n_forced*6)');
    expect(value(encode, '-vf')).toMatch(/subtitles=subs\.ass$/);
    expect(value(encode, '-segment_times')!.startsWith('6.000,12.000,')).toBe(true);
  });

  it('starts FFmpeg where the TV starts and restarts it only for segments far from what it writes', async () => {
    const { runs, start, get, settle } = setup();
    const s = await start(125_000); // 2:05 → segment 20
    expect(runs.map((r) => r.from)).toEqual([20]);
    const first = get(s, 20);
    runs[0]!.write(2);
    await expect(first).resolves.toMatch(/seg00020\.ts$/);
    // Close ahead: FFmpeg gets there on its own.
    const near = get(s, 23);
    await settle();
    expect(runs).toHaveLength(1);
    runs[0]!.write(2);
    await near;
    // A seek far ahead, then back before the start of the run: new runs there, the old ones are killed.
    const far = get(s, 300);
    await settle();
    expect(runs.map((r) => r.from)).toEqual([20, 300]);
    expect(runs[0]!.killed).toBe(true);
    runs[1]!.write(1);
    await far;
    const back = get(s, 5);
    await settle();
    expect(runs.map((r) => r.from)).toEqual([20, 300, 5]);
    runs[2]!.write(1);
    await back;
    // Already finished segments come straight from disk.
    await expect(get(s, 21)).resolves.toMatch(/seg00021\.ts$/);
    expect(runs).toHaveLength(3);
  });

  it('never serves a segment FFmpeg is still writing', async () => {
    const { runs, start, get, settle } = setup();
    const s = await start(0);
    runs[0]!.partial();
    const wait = get(s, 0);
    let done = false;
    void wait.then(() => (done = true));
    await settle();
    await settle();
    expect(done).toBe(false);
    runs[0]!.write(1);
    await expect(wait).resolves.toMatch(/seg00000\.ts$/);
  });

  it('stops FFmpeg far ahead of the player and starts it again before the player runs out', async () => {
    const { transcoder, runs, start, get, settle } = setup();
    const s = await start(0);
    runs[0]!.write(60); // 0..59, the player is at 0
    transcoder.sweep();
    expect(runs[0]!.killed).toBe(true);
    expect(transcoder.list()[0]!.runningFrom).toBeNull();
    // Far from the end of what exists: nothing to do yet.
    await get(s, 10);
    await settle();
    expect(runs).toHaveLength(1);
    // Within two minutes of the end: FFmpeg continues after the last segment.
    await get(s, 45);
    await settle();
    expect(runs.map((r) => r.from)).toEqual([0, 60]);
  });

  it('survives a long pause: FFmpeg stops when idle, the session stays and starts again on demand', async () => {
    const { transcoder, runs, start, get, tick, settle } = setup();
    const s = await start(0);
    runs[0]!.write(5);
    await get(s, 1);
    tick(61_000);
    transcoder.sweep();
    expect(runs[0]!.killed).toBe(true);
    tick(2 * 60 * 60_000); // two hours paused
    transcoder.sweep();
    expect(transcoder.list()).toHaveLength(1);
    await expect(get(s, 2)).resolves.toMatch(/seg00002\.ts$/);
    await settle();
    expect(runs.map((r) => r.from)).toEqual([0, 5]); // started ahead of the player again
    const next = get(s, 5);
    runs[1]!.write(1);
    await next;
    // Hours without any request end the session.
    tick(7 * 60 * 60_000);
    transcoder.sweep();
    expect(transcoder.list()).toHaveLength(0);
  });

  it('gives up with TV_UNSUPPORTED_MEDIA when FFmpeg fails twice for a segment', async () => {
    const { runs, start, get, settle } = setup();
    const s = await start(0);
    const wait = get(s, 0);
    await settle();
    runs[0]!.exit(1);
    for (let i = 0; i < 20 && runs.length < 2; i++) await settle();
    runs[1]!.exit(1);
    await expect(wait).rejects.toMatchObject({ code: 'TV_UNSUPPORTED_MEDIA' });
  });
});
