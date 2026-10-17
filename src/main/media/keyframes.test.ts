import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nullLogger } from '../logger';
import { resolveFfmpeg } from './ffmpeg-path';
import { forTests, KeyframeIndex, segmentStarts } from './keyframes';

describe('segment starts', () => {
  it('cuts a copy at the first keyframe at least one segment after the previous start, an encode evenly', () => {
    expect(segmentStarts(20_000, 6000, null)).toEqual([0, 6000, 12_000, 18_000]);
    // Keyframes every 10 s, then dense ones (scene cuts): never shorter than 6 s, nothing in the last half second.
    expect(segmentStarts(45_000, 6000, [0, 10_000, 20_000, 21_000, 22_000, 26_500, 30_000, 44_800])).toEqual([
      0, 10_000, 20_000, 26_500,
    ]);
  });
});

/** Real FFmpeg on own synthetic clips (D-23); skipped without binaries. */
const tools = resolveFfmpeg({ env: process.env, isPackaged: false, resourcesPath: '', appRoot: resolve('.') });

describe.skipIf(!tools)('keyframe index (real files)', () => {
  let dir: string;
  const ff = (args: string[]) => execFileSync(tools!.ffmpeg, ['-v', 'error', '-y', ...args]);
  /** Ground truth: keyframes of the video stream as ffprobe reads them from the packets. */
  const truth = (path: string) =>
    execFileSync(
      tools!.ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path],
      { encoding: 'utf8' },
    )
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.split(',')[1]?.startsWith('K'))
      .map((l) => Math.round(Number(l.split(',')[0]) * 1000))
      .sort((a, b) => a - b);
  const source = ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=40', '-f', 'lavfi', '-i', 'sine=d=40'];
  // Keyframes every 2 s plus one forced at 7.4 s (a "scene cut").
  const video = ['-c:v', 'libx264', '-g', '50', '-force_key_frames', '7.4', '-pix_fmt', 'yuv420p'];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'adr-keyframes-'));
    ff([...source, ...video, '-c:a', 'aac', join(dir, 'a.mkv')]);
    ff([...source, ...video, '-c:a', 'aac', join(dir, 'a.mp4')]);
    ff([...source, ...video, '-c:a', 'mp2', '-f', 'mpegts', join(dir, 'a.ts')]);
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const close = (a: number[] | null, b: number[]) => {
    expect(a).not.toBeNull();
    expect(a!.map((x) => Math.round(x))).toEqual(b);
  };

  it('reads Matroska Cues: the points a stream copy can start from', () => {
    const cues = forTests.matroskaKeyframes(join(dir, 'a.mkv'));
    const keys = truth(join(dir, 'a.mkv'));
    expect(cues).not.toBeNull();
    // Every cue is a keyframe; FFmpeg's muxer indexes the keyframes that start clusters.
    for (const c of cues!) expect(keys).toContain(Math.round(c));
    expect(cues![0]).toBe(0);
  });

  it('reads MP4 sync samples with composition offsets and the edit list', () => {
    const path = join(dir, 'a.mp4');
    close(forTests.mp4Keyframes(path, statSync(path).size), truth(path));
  });

  it('scans other containers with ffprobe, relative to the start of the file', async () => {
    const path = join(dir, 'a.ts');
    const start = Math.round(
      Number(
        execFileSync(tools!.ffprobe, ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', path], {
          encoding: 'utf8',
        }),
      ) * 1000,
    );
    const scanned = await forTests.probeKeyframes(tools!.ffprobe, path, 60_000);
    close(
      scanned,
      truth(path).map((x) => x - start),
    );
  });

  it('caches the index on disk per file version', async () => {
    const index = new KeyframeIndex({ dir: join(dir, 'cache'), ffprobe: tools!.ffprobe, log: nullLogger });
    const path = join(dir, 'a.mp4');
    const src = { path, container: 'mp4', sizeBytes: statSync(path).size, mtimeMs: 1, itemId: 'job~0' };
    const first = await index.get(src);
    const again = await new KeyframeIndex({ dir: join(dir, 'cache'), ffprobe: null, log: nullLogger }).get(src);
    expect(again).toEqual(first!.map((x) => Math.round(x * 1000) / 1000));
  });
});
