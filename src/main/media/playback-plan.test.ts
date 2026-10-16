import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type DeviceProfile,
  type EncoderSupport,
  type MediaProbe,
  planPlayback,
  type TranscodeSettings,
} from '@shared/domain/playback';
import { parseProbe, type RawFrames, type RawProbe } from './probe';

const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/ffprobe', name), 'utf8')) as T;
const probe = (name: string, frames?: string): MediaProbe =>
  parseProbe(
    fixture<RawProbe>(name),
    `C:/films/${name.replace(/\.json$/, '')}`,
    1,
    frames ? fixture<RawFrames>(frames) : undefined,
  );

/** Samsung 2021 (Tizen 6): 4K HDR10/HDR10+/HLG, no Dolby Vision, no DTS/TrueHD. */
const samsung: DeviceProfile = {
  platform: 'tizen',
  model: 'QE55Q80A',
  maxWidth: 3840,
  maxHeight: 2160,
  video: [
    { codec: 'h264', maxWidth: 3840, maxHeight: 2160, tenBit: false },
    { codec: 'hevc', maxWidth: 3840, maxHeight: 2160, tenBit: true },
    { codec: 'vp9', maxWidth: 3840, maxHeight: 2160, tenBit: true },
    { codec: 'av1', maxWidth: 3840, maxHeight: 2160, tenBit: true },
  ],
  hdr: { hdr10: true, hdr10plus: true, hlg: true, dolbyVision: [] },
  audioDecode: ['aac', 'ac3', 'eac3', 'mp3', 'opus', 'flac'],
  audioPassthrough: ['ac3', 'eac3', 'eac3-joc'],
  maxAudioChannels: 6,
  containers: ['mp4', 'mkv', 'webm', 'ts'],
  hls: true,
};
/** Android TV box with Dolby Vision and full passthrough to an AV receiver. */
const androidDv: DeviceProfile = {
  ...samsung,
  platform: 'android',
  model: 'SHIELD',
  hdr: { hdr10: true, hdr10plus: false, hlg: true, dolbyVision: [5, 8] },
  audioPassthrough: ['ac3', 'eac3', 'eac3-joc', 'truehd', 'dts', 'dts-hd'],
  maxAudioChannels: 8,
};
/** Old 1080p SDR TV with stereo AAC only. */
const sdr1080: DeviceProfile = {
  platform: 'web',
  model: null,
  maxWidth: 1920,
  maxHeight: 1080,
  video: [{ codec: 'h264', maxWidth: 1920, maxHeight: 1080, tenBit: false }],
  hdr: { hdr10: false, hdr10plus: false, hlg: false, dolbyVision: [] },
  audioDecode: ['aac', 'mp3'],
  audioPassthrough: [],
  maxAudioChannels: 2,
  containers: ['mp4'],
  hls: true,
};
const settings: TranscodeSettings = { hwAccel: 'auto', maxHeight: 2160, maxBitrateMbps: 40 };
const nvidia: EncoderSupport = { hardware: 'nvenc', hevc: true, libplacebo: true };
const cpuOnly: EncoderSupport = { hardware: null, hevc: true, libplacebo: false };
const plan = (p: MediaProbe, device: DeviceProfile, extra: Partial<Parameters<typeof planPlayback>[0]> = {}) =>
  planPlayback({ probe: p, device, settings, encoders: nvidia, ...extra });

describe('ffprobe parsing (D-85)', () => {
  it('reads container, codecs, HDR10, audio and subtitles of real samples', () => {
    const mp4 = probe('h264-aac.mp4.json');
    expect(mp4).toMatchObject({ container: 'mp4', video: { codec: 'h264', bitDepth: 8, hdr: 'sdr', width: 1280 } });
    expect(mp4.audio).toMatchObject([{ codec: 'aac', channels: 2 }]);
    const mkv = probe('hevc10-hdr10-truehd.mkv.json');
    expect(mkv.container).toBe('mkv');
    expect(mkv.video).toMatchObject({ codec: 'hevc', bitDepth: 10, hdr: 'hdr10', hdr10plus: false, dolbyVision: null });
    expect(mkv.audio.map((a) => [a.codec, a.channels, a.language])).toEqual([
      ['truehd', 6, 'eng'],
      ['eac3', 6, 'pol'],
    ]);
    expect(mkv.subtitles.map((s) => [s.codec, s.language, s.image])).toEqual([
      ['subrip', 'eng', false],
      ['ass', 'pol', false],
    ]);
  });

  it('detects HDR10+, Dolby Vision profiles, Atmos, DTS-HD and image subtitles', () => {
    expect(probe('hevc10-hdr10-truehd.mkv.json', 'hdr10plus-frames.json').video).toMatchObject({
      hdr: 'hdr10plus',
      hdr10plus: true,
    });
    const p5 = probe('dv-p5-eac3-atmos.mp4.json');
    expect(p5.video).toMatchObject({ hdr: 'dv', dolbyVision: { profile: 5, blCompatibility: 0 } });
    expect(p5.audio[0]).toMatchObject({ codec: 'eac3', atmos: true });
    const p8 = probe('dv-p8-truehd-atmos-pgs.mkv.json');
    expect(p8.video).toMatchObject({ hdr: 'hdr10', dolbyVision: { profile: 8, blCompatibility: 1 } });
    expect(p8.audio[0]).toMatchObject({ codec: 'truehd', atmos: true });
    expect(p8.subtitles.find((s) => s.codec === 'hdmv_pgs_subtitle')?.image).toBe(true);
    const p7 = probe('dv-p7-dtshd.mkv.json');
    expect(p7.video?.dolbyVision).toMatchObject({ profile: 7, enhancementLayer: true });
    expect(p7.audio[0]).toMatchObject({ codec: 'dts', dtsHd: true, channels: 8 });
  });
});

describe('PlaybackPlanner (D-85)', () => {
  it('direct play when everything fits', () => {
    const p = plan(probe('h264-aac.mp4.json'), sdr1080);
    expect(p).toMatchObject({ mode: 'direct', delivery: 'file', video: { action: 'copy' }, audio: { action: 'copy' } });
  });

  it('remuxes to HLS when only the container is unsupported', () => {
    const p = plan(probe('h264-aac.mp4.json'), { ...sdr1080, containers: ['ts'] });
    expect(p).toMatchObject({ mode: 'remux', delivery: 'hls', video: { action: 'copy' }, audio: { action: 'copy' } });
  });

  it('plays HDR10 + TrueHD directly on Android with passthrough, but converts TrueHD for Samsung', () => {
    const file = probe('hevc10-hdr10-truehd.mkv.json');
    expect(plan(file, androidDv).mode).toBe('direct');
    const s = plan(file, samsung);
    expect(s).toMatchObject({
      mode: 'audio',
      delivery: 'hls',
      video: { action: 'copy', codec: 'hevc' },
      audio: { action: 'encode', codec: 'eac3', channels: 6 },
    });
    // Choosing the E-AC3 track instead avoids any conversion.
    expect(plan(file, samsung, { audioIndex: 2 }).mode).toBe('direct');
  });

  it('tone maps HDR10 for an SDR TV, scaling 4K to its 1080p limit with the hardware encoder', () => {
    const p = plan(probe('hevc10-hdr10-truehd.mkv.json'), sdr1080);
    expect(p).toMatchObject({
      mode: 'video',
      video: {
        action: 'encode',
        codec: 'h264',
        encoder: 'h264_nvenc',
        toneMap: 'libplacebo',
        height: 1080,
        width: 1920,
      },
      audio: { action: 'encode', codec: 'aac', channels: 2 },
    });
    expect(p.reasons.join(' ')).toMatch(/tone mapping/);
  });

  it('always tone maps Dolby Vision profile 5 on a TV without DV, and refuses without GPU tone mapping', () => {
    const file = probe('dv-p5-eac3-atmos.mp4.json');
    const p = plan(file, samsung);
    expect(p).toMatchObject({ mode: 'video', video: { toneMap: 'libplacebo', codec: 'hevc' }, error: null });
    // Atmos (E-AC3 JOC) is copied: the Samsung passes it through.
    expect(p.audio).toMatchObject({ action: 'copy', codec: 'eac3' });
    expect(p.reasons).toContain('Atmos kept (passthrough)');
    expect(planPlayback({ probe: file, device: samsung, settings, encoders: cpuOnly }).error).toMatch(/profile 5/);
    // A DV TV plays it as it is.
    expect(plan(file, androidDv).mode).toBe('direct');
  });

  it('plays DV profile 8.1 as HDR10 on an HDR TV without DV and DV profile 7 as its HDR10 base', () => {
    const p8 = plan(probe('dv-p8-truehd-atmos-pgs.mkv.json'), samsung);
    expect(p8.video.action).toBe('copy');
    expect(p8.reasons.join(' ')).toMatch(/profile 8 plays as HDR10/);
    expect(p8.audio).toMatchObject({ action: 'encode', codec: 'eac3' });
    expect(p8.reasons.join(' ')).toMatch(/Atmos is not kept/);
    const p7 = plan(probe('dv-p7-dtshd.mkv.json'), samsung);
    expect(p7.video.action).toBe('copy');
    expect(p7.audio).toMatchObject({ action: 'encode', codec: 'eac3', channels: 6 });
  });

  it('keeps DTS-HD bit-exact for passthrough and burns in PGS subtitles (video encode)', () => {
    expect(
      plan(probe('dv-p7-dtshd.mkv.json'), { ...androidDv, hdr: { ...androidDv.hdr, dolbyVision: [7] } }).mode,
    ).toBe('direct');
    const pgs = plan(probe('dv-p8-truehd-atmos-pgs.mkv.json'), androidDv, { subtitle: { kind: 'embedded', index: 5 } });
    expect(pgs).toMatchObject({ mode: 'video', subtitles: { delivery: 'burn-in', index: 5 } });
  });

  it('extracts text subtitles without transcoding and burns styled ASS only when encoding anyway', () => {
    const file = probe('hevc10-hdr10-truehd.mkv.json');
    expect(plan(file, androidDv, { subtitle: { kind: 'embedded', index: 4 } })).toMatchObject({
      mode: 'direct',
      subtitles: { delivery: 'extract-vtt' },
    });
    expect(plan(file, sdr1080, { subtitle: { kind: 'embedded', index: 4 } }).subtitles.delivery).toBe('burn-in');
    expect(plan(file, androidDv, { subtitle: { kind: 'external', lang: 'en' } }).subtitles).toMatchObject({
      delivery: 'external-vtt',
      lang: 'en',
    });
  });

  it('transcodes codecs the TV does not know and honours the PC limits and encoder choice', () => {
    const avi = probe('xvid-mp3.avi.json');
    const p = planPlayback({
      probe: avi,
      device: samsung,
      settings: { hwAccel: 'cpu', maxHeight: 720, maxBitrateMbps: 8 },
      encoders: nvidia,
    });
    expect(p).toMatchObject({
      mode: 'video',
      video: { encoder: 'libx264', codec: 'h264', height: 400, bitrateKbps: 1500 },
      audio: { action: 'copy', codec: 'mp3' },
    });
    const capped = planPlayback({
      probe: probe('hevc10-hdr10-truehd.mkv.json'),
      device: sdr1080,
      settings: { hwAccel: 'auto', maxHeight: 720, maxBitrateMbps: 6 },
      encoders: { hardware: 'qsv', hevc: false, libplacebo: false },
    });
    expect(capped.video).toMatchObject({ encoder: 'h264_qsv', height: 720, width: 1280, toneMap: 'zscale' });
    expect(capped.video.bitrateKbps).toBeLessThanOrEqual(6000);
  });
});
