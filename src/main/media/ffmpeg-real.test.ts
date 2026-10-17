import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DeviceProfile, type PlaybackPlan, planPlayback } from '@shared/domain/playback';
import { nullLogger } from '../logger';
import { resolveFfmpeg } from './ffmpeg-path';
import { SEGMENT_SECONDS } from './ffmpeg-args';
import { KeyframeIndex, segmentStarts } from './keyframes';
import { EncoderDetector } from './hwaccel';
import { probeFile } from './probe';
import { runFfmpegIn, spawnFfmpeg, type TranscodeSession, Transcoder } from './transcoder';

/**
 * Real FFmpeg on own synthetic clips (testsrc2 + sine, D-23). Runs when FFmpeg is available: vendor/ffmpeg
 * (scripts/fetch-ffmpeg.mjs) or ADRENALINE_FFMPEG_DIR. Skipped otherwise (CI app job without binaries).
 */
const tools = resolveFfmpeg({ env: process.env, isPackaged: false, resourcesPath: '', appRoot: resolve('.') });

const tv: DeviceProfile = {
  platform: 'tizen',
  model: null,
  maxWidth: 1920,
  maxHeight: 1080,
  video: [
    { codec: 'h264', maxWidth: 1920, maxHeight: 1080, tenBit: false },
    { codec: 'hevc', maxWidth: 1920, maxHeight: 1080, tenBit: true },
  ],
  hdr: { hdr10: false, hdr10plus: false, hlg: false, dolbyVision: [] },
  audioDecode: ['aac', 'ac3', 'eac3'],
  audioPassthrough: [],
  maxAudioChannels: 6,
  containers: ['mp4'],
  hls: true,
};

describe.skipIf(!tools)('FFmpeg pipeline (real binaries)', () => {
  let dir: string;
  let transcoder: Transcoder;
  const ff = (args: string[]) => execFileSync(tools!.ffmpeg, ['-v', 'error', '-y', ...args]);
  const streams = (path: string) =>
    JSON.parse(
      execFileSync(tools!.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-i', path], {
        encoding: 'utf8',
      }),
    ) as { streams: { codec_name: string; codec_type: string; color_transfer?: string; channels?: number }[] };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'adr-ffmpeg-'));
    writeFileSync(join(dir, 's.srt'), '1\n00:00:00,500 --> 00:00:02,500\nZażółć gęślą jaźń\n');
    // 1080p H.264 + AAC in MKV with an SRT track (remux case).
    ff([
      ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=duration=4'],
      ...['-i', join(dir, 's.srt'), '-map', '0', '-map', '1', '-map', '2'],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24', '-c:a', 'aac', '-c:s', 'srt', join(dir, 'h264.mkv')],
    ]);
    // 30 s of H.264 with a keyframe every 7 s (longer than a segment: seeks and cuts at keyframes).
    ff([
      ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=30', '-f', 'lavfi', '-i', 'sine=duration=30'],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '168', '-keyint_min', '168', '-sc_threshold', '0'],
      ...['-c:a', 'aac', join(dir, 'long.mkv')],
    ]);
    // HEVC Main10 HDR10 + TrueHD 5.1 + ASS (tone mapping, audio conversion and burn-in).
    ff([
      ...['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=duration=3'],
      ...['-i', join(dir, 's.srt'), '-map', '0', '-map', '1', '-map', '2'],
      ...['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le'],
      '-x265-params',
      'hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:log-level=error',
      ...['-c:a', 'truehd', '-strict', '-2', '-ac', '6', '-c:s', 'ass', join(dir, 'hdr.mkv')],
    ]);
    transcoder = new Transcoder({
      cacheDir: join(dir, 'transcode'),
      spawn: spawnFfmpeg(tools!.ffmpeg),
      runFfmpeg: runFfmpegIn(tools!.ffmpeg),
      log: nullLogger,
      cacheLimitBytes: () => 1e9,
    });
  }, 120_000);
  afterAll(() => {
    transcoder?.stopAll();
    rmSync(dir, { recursive: true, force: true });
  });

  const finish = async (id: string) => {
    for (let i = 0; i < 600; i++) {
      const s = transcoder.list().find((x) => x.id === id);
      if (!s || s.finished) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('ffmpeg did not finish');
  };

  const segments = (dir: string, ext: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(ext))
      .sort();
  /** Film time of the first video frame of a segment and whether it is a keyframe. */
  const firstFrame = (path: string) => {
    const out = JSON.parse(
      execFileSync(
        tools!.ffprobe,
        [
          ...['-v', 'error', '-print_format', 'json', '-select_streams', 'v:0', '-read_intervals', '%+#1'],
          ...['-show_entries', 'frame=pts_time,key_frame', '-i', path],
        ],
        { encoding: 'utf8' },
      ),
    ) as { frames: { pts_time: string; key_frame: number }[] };
    // MPEG-TS adds its 1.4 s muxing delay to the film time; B-frames delay the first picture by a frame or two.
    return {
      time: Math.floor((Number(out.frames[0]!.pts_time) - 1.4) * 10 + 1e-6) / 10,
      key: out.frames[0]!.key_frame === 1,
    };
  };

  /** Start request for a file: segments from its keyframes for a copy, even ones for an encode. */
  const request = async (deviceId: string, path: string, plan: PlaybackPlan, durationMs: number, startMs = 0) => {
    const keyframes =
      plan.video.action === 'copy'
        ? await new KeyframeIndex({ dir: join(dir, 'keyframes'), ffprobe: tools!.ffprobe, log: nullLogger }).get({
            path,
            container: 'mkv',
            sizeBytes: 1,
            mtimeMs: 1,
            itemId: path.replace(/\W/g, ''),
          })
        : null;
    return {
      deviceId,
      itemId: `${deviceId}~0`,
      input: path,
      plan,
      durationMs,
      starts: segmentStarts(durationMs, SEGMENT_SECONDS * 1000, keyframes),
      startMs,
    };
  };
  const segmentPath = (session: TranscodeSession, n: number) =>
    join(session.dir, `seg${String(n).padStart(5, '0')}.ts`);

  it('probes, remuxes MKV to HLS without re-encoding, cut at its keyframes, from any segment', async () => {
    const path = join(dir, 'long.mkv');
    const probe = await probeFile(tools!.ffprobe, path, 1);
    expect(probe).toMatchObject({ container: 'mkv', video: { codec: 'h264' } });
    const encoders = await EncoderDetector.forFfmpeg(tools!.ffmpeg, nullLogger).detect('auto');
    const plan = planPlayback({
      probe,
      device: tv,
      settings: { hwAccel: 'auto', maxHeight: 1080, maxBitrateMbps: 10 },
      encoders,
    });
    expect(plan).toMatchObject({ mode: 'remux' });
    const req = await request('d1', path, plan, probe.durationMs!);
    // Keyframes every 7 s: segments start at 0, 7, 14, 21, 28 (not every 6 s).
    expect(req.starts).toEqual([0, 7000, 14_000, 21_000, 28_000]);
    const session = await transcoder.start(req);
    await transcoder.file(session, 'seg00000.ts');
    const done = await finish(session.id);
    expect(done?.exitCode).toBe(0);
    expect(segments(session.dir, '.ts').length).toBe(5);
    expect(streams(segmentPath(session, 0)).streams.map((s) => s.codec_name)).toEqual(['h264', 'aac']);
    for (const [n, t] of req.starts.entries())
      expect(firstFrame(segmentPath(session, n))).toEqual({ time: t / 1000, key: true });
    expect(transcoder.playlist(session)).toContain('#EXTINF:7.000000,\nseg00001.ts');

    // A seek into the middle: a new run from segment 3 starts at its keyframe (21 s) and keeps the same cuts.
    const seek = await transcoder.start({ ...req, startMs: 23_000 });
    expect(firstFrame(await transcoder.file(seek, 'seg00003.ts'))).toEqual({ time: 21, key: true });
    expect(firstFrame(await transcoder.file(seek, 'seg00004.ts'))).toEqual({ time: 28, key: true });
  }, 120_000);

  it('tone maps HDR10 to SDR H.264, converts TrueHD to E-AC3 and burns in ASS subtitles', async () => {
    const path = join(dir, 'hdr.mkv');
    const probe = await probeFile(tools!.ffprobe, path, 1);
    expect(probe.video).toMatchObject({ hdr: 'hdr10', bitDepth: 10 });
    const encoders = await EncoderDetector.forFfmpeg(tools!.ffmpeg, nullLogger).detect('auto');
    const plan = planPlayback({
      probe,
      device: tv,
      settings: { hwAccel: 'auto', maxHeight: 720, maxBitrateMbps: 6 },
      encoders,
      subtitle: { kind: 'embedded', index: probe.subtitles[0]!.index },
    });
    expect(plan).toMatchObject({ mode: 'video', subtitles: { delivery: 'burn-in' }, audio: { codec: 'eac3' } });
    const session = await transcoder.start(await request('d2', path, plan, probe.durationMs!));
    expect(existsSync(join(session.dir, 'subs.ass'))).toBe(true);
    const done = await finish(session.id);
    expect(done?.exitCode).toBe(0);
    const out = streams(segmentPath(session, 0)).streams;
    expect(out.map((s) => s.codec_name)).toEqual(['h264', 'eac3']);
    expect(out[0]!.color_transfer ?? 'bt709').not.toBe('smpte2084');
    expect(out[1]!.channels).toBe(6);
  }, 180_000);

  it('encodes from a later segment with a keyframe exactly at its start (film time)', async () => {
    const path = join(dir, 'long.mkv');
    const probe = await probeFile(tools!.ffprobe, path, 1);
    const plan = planPlayback({
      probe,
      device: { ...tv, containers: [], video: [{ codec: 'hevc', maxWidth: 1920, maxHeight: 1080, tenBit: true }] },
      settings: { hwAccel: 'cpu', maxHeight: 720, maxBitrateMbps: 4 },
      encoders: { hardware: null, hevc: false, libplacebo: false },
    });
    expect(plan).toMatchObject({ mode: 'video', video: { encoder: 'libx264' } });
    const session = await transcoder.start(await request('d5', path, plan, probe.durationMs!, 12_000));
    expect(firstFrame(await transcoder.file(session, 'seg00002.ts'))).toEqual({ time: 12, key: true });
    expect(firstFrame(await transcoder.file(session, 'seg00003.ts'))).toEqual({ time: 18, key: true });
  }, 120_000);

  it('copies HEVC HDR10 into MPEG-TS HLS for Samsung AVPlay while converting TrueHD to E-AC3', async () => {
    const path = join(dir, 'hdr.mkv');
    const probe = await probeFile(tools!.ffprobe, path, 1);
    const samsung: DeviceProfile = {
      ...tv,
      maxWidth: 3840,
      maxHeight: 2160,
      hdr: { hdr10: true, hdr10plus: true, hlg: true, dolbyVision: [] },
      containers: ['mp4', 'mkv'],
    };
    const plan = planPlayback({
      probe,
      device: samsung,
      settings: { hwAccel: 'auto', maxHeight: 2160, maxBitrateMbps: 40 },
      encoders: { hardware: null, hevc: true, libplacebo: false },
    });
    expect(plan).toMatchObject({ mode: 'audio', video: { action: 'copy' }, audio: { codec: 'eac3' } });
    const session = await transcoder.start(await request('d4', path, plan, probe.durationMs!));
    const done = await finish(session.id);
    expect(done?.exitCode).toBe(0);
    expect(segments(session.dir, '.ts').length).toBeGreaterThan(0);
    const out = streams(segmentPath(session, 0)).streams;
    expect(out.map((s) => s.codec_name)).toEqual(['hevc', 'eac3']);
    expect(out[0]!.color_transfer).toBe('smpte2084');
    expect(out[1]!.channels).toBe(6);
  }, 120_000);

  it('stops the process and deletes the session folder on revoke', async () => {
    const path = join(dir, 'h264.mkv');
    const probe = await probeFile(tools!.ffprobe, path, 1);
    const plan = planPlayback({
      probe,
      device: { ...tv, containers: [] },
      settings: { hwAccel: 'cpu', maxHeight: 720, maxBitrateMbps: 4 },
      encoders: { hardware: null, hevc: false, libplacebo: false },
    });
    const session = await transcoder.start(await request('d3', path, plan, probe.durationMs!));
    transcoder.stopDevice('d3');
    expect(transcoder.list().some((s) => s.id === session.id)).toBe(false);
    for (let i = 0; i < 40 && existsSync(session.dir); i++) await new Promise((r) => setTimeout(r, 250));
    expect(existsSync(session.dir)).toBe(false);
  }, 60_000);
});
