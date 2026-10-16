import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DeviceProfile, planPlayback } from '@shared/domain/playback';
import { nullLogger } from '../logger';
import { resolveFfmpeg } from './ffmpeg-path';
import { PLAYLIST } from './ffmpeg-args';
import { EncoderDetector } from './hwaccel';
import { probeFile } from './probe';
import { runFfmpegIn, spawnFfmpeg, Transcoder } from './transcoder';

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

  it('probes, remuxes MKV to HLS fMP4 without re-encoding and extracts nothing it does not need', async () => {
    const path = join(dir, 'h264.mkv');
    const probe = await probeFile(tools!.ffprobe, path, 1);
    expect(probe).toMatchObject({ container: 'mkv', video: { codec: 'h264' } });
    const encoders = await EncoderDetector.forFfmpeg(tools!.ffmpeg, nullLogger).detect('auto');
    const plan = planPlayback({
      probe,
      device: tv,
      settings: { hwAccel: 'auto', maxHeight: 1080, maxBitrateMbps: 10 },
      encoders,
    });
    expect(plan.mode).toBe('remux');
    const session = await transcoder.start({ deviceId: 'd1', itemId: 'i~0', input: path, plan, startMs: 0 });
    await transcoder.waitForFile(session, PLAYLIST);
    const done = await finish(session.id);
    expect(done?.exitCode).toBe(0);
    const files = readdirSync(session.dir);
    expect(files).toContain('init.mp4');
    expect(files.filter((f) => f.endsWith('.m4s')).length).toBeGreaterThan(0);
    expect(readFileSync(join(session.dir, PLAYLIST), 'utf8')).toContain('#EXT-X-MAP:URI="init.mp4"');
    const out = streams(join(session.dir, PLAYLIST)).streams.map((s) => s.codec_name);
    expect(out).toEqual(['h264', 'aac']);
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
    const session = await transcoder.start({ deviceId: 'd2', itemId: 'i~1', input: path, plan, startMs: 1000 });
    expect(existsSync(join(session.dir, 'subs.ass'))).toBe(true);
    const done = await finish(session.id);
    expect(done?.exitCode).toBe(0);
    const out = streams(join(session.dir, PLAYLIST)).streams;
    expect(out.map((s) => s.codec_name)).toEqual(['h264', 'eac3']);
    expect(out[0]!.color_transfer ?? 'bt709').not.toBe('smpte2084');
    expect(out[1]!.channels).toBe(6);
  }, 180_000);

  it('stops the process and deletes the session folder on revoke', async () => {
    const path = join(dir, 'h264.mkv');
    const probe = await probeFile(tools!.ffprobe, path, 1);
    const plan = planPlayback({
      probe,
      device: { ...tv, containers: [] },
      settings: { hwAccel: 'cpu', maxHeight: 720, maxBitrateMbps: 4 },
      encoders: { hardware: null, hevc: false, libplacebo: false },
    });
    const session = await transcoder.start({ deviceId: 'd3', itemId: 'i~2', input: path, plan, startMs: 0 });
    transcoder.stopDevice('d3');
    expect(transcoder.list().some((s) => s.id === session.id)).toBe(false);
    for (let i = 0; i < 40 && existsSync(session.dir); i++) await new Promise((r) => setTimeout(r, 250));
    expect(existsSync(session.dir)).toBe(false);
  }, 60_000);
});
