/**
 * Playback negotiation (D-85, docs/1.0-adrenaline-tv/06-playback-negotiation.md), in the style of Jellyfin: what the
 * file is (MediaProbe, from ffprobe), what the TV can do (DeviceProfile, reported by the TV app) and what the PC allows
 * (TranscodeSettings) give the cheapest working variant: direct play → remux to HLS fMP4 → audio-only transcode →
 * video transcode (hardware encoder, tone mapping, burn-in). Pure code: no FFmpeg, no I/O.
 */

// ---------------------------------------------------------------- the file

export type HdrFormat = 'sdr' | 'hdr10' | 'hdr10plus' | 'hlg' | 'dv';

export interface DolbyVision {
  profile: number;
  level: number | null;
  /** dv_bl_signal_compatibility_id: 0 none (profile 5), 1 HDR10, 2 SDR, 4 HLG, 6 Blu-ray HDR10. */
  blCompatibility: number | null;
  /** Profile 7 dual layer: an enhancement layer is present. */
  enhancementLayer: boolean;
}

export interface VideoStream {
  index: number;
  codec: string;
  profile: string | null;
  level: number | null;
  width: number;
  height: number;
  bitDepth: number;
  frameRate: number | null;
  /** Main dynamic range of the stream; `dolbyVision` adds the DV layer on top of it. */
  hdr: HdrFormat;
  hdr10plus: boolean;
  dolbyVision: DolbyVision | null;
}

export interface AudioStream {
  index: number;
  codec: string;
  profile: string | null;
  channels: number;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  /** E-AC3 JOC or TrueHD with Atmos (from the ffprobe profile). */
  atmos: boolean;
  /** DTS-HD MA/HRA or DTS:X (core DTS is still decodable by plain DTS decoders). */
  dtsHd: boolean;
}

export interface SubtitleStream {
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  forced: boolean;
  /** Bitmap subtitles (PGS, VobSub, DVB) can only be burned in. */
  image: boolean;
}

export interface MediaProbe {
  /** Normalized container: mp4, mkv, webm, ts, avi, mov, other. */
  container: string;
  durationMs: number | null;
  bitrate: number | null;
  sizeBytes: number;
  video: VideoStream | null;
  audio: AudioStream[];
  subtitles: SubtitleStream[];
}

// ---------------------------------------------------------------- the TV

export interface VideoCodecSupport {
  codec: string;
  maxWidth: number;
  maxHeight: number;
  /** 10-bit (Main10 / High10) decoding. */
  tenBit: boolean;
}

export interface DeviceProfile {
  platform: 'android' | 'tizen' | 'web';
  model: string | null;
  /** Panel/output limit. */
  maxWidth: number;
  maxHeight: number;
  video: VideoCodecSupport[];
  hdr: { hdr10: boolean; hdr10plus: boolean; hlg: boolean; dolbyVision: number[] };
  /** Codecs the TV decodes itself: aac, ac3, eac3, truehd, dts, dts-hd, flac, opus, mp3, … */
  audioDecode: string[];
  /** Codecs sent bit-exact to an AV receiver/soundbar: ac3, eac3, eac3-joc, truehd, dts, dts-hd. */
  audioPassthrough: string[];
  maxAudioChannels: number;
  /** Containers the player opens directly (mp4, mkv, webm, ts, mov, avi). */
  containers: string[];
  /** HLS with fMP4 segments. */
  hls: boolean;
}

// ---------------------------------------------------------------- the PC

export type HwAccel = 'auto' | 'nvenc' | 'qsv' | 'amf' | 'cpu';

export interface TranscodeSettings {
  hwAccel: HwAccel;
  maxHeight: number;
  maxBitrateMbps: number;
}

export interface EncoderSupport {
  /** Hardware family that works on this PC (null = CPU only). */
  hardware: 'nvenc' | 'qsv' | 'amf' | null;
  /** HEVC encoding is available (hardware or libx265). */
  hevc: boolean;
  /** libplacebo with a Vulkan device: tone mapping that also handles Dolby Vision profile 5. */
  libplacebo: boolean;
}

// ---------------------------------------------------------------- the plan

export type SubtitleChoice =
  | { kind: 'none' }
  /** Subtitle file next to the video (downloaded by Adrenaline). */
  | { kind: 'external'; lang: string }
  | { kind: 'embedded'; index: number };

export type PlaybackMode = 'direct' | 'remux' | 'audio' | 'video';

export interface PlaybackPlan {
  mode: PlaybackMode;
  /** `file`: the original via HTTP Range; `hls`: FFmpeg writes HLS with fMP4 segments. */
  delivery: 'file' | 'hls';
  video: {
    index: number | null;
    action: 'copy' | 'encode';
    codec: string;
    encoder: string | null;
    toneMap: 'none' | 'zscale' | 'libplacebo';
    width: number | null;
    height: number | null;
    bitrateKbps: number | null;
  };
  audio: {
    index: number | null;
    action: 'copy' | 'encode' | 'none';
    codec: string;
    channels: number | null;
    bitrateKbps: number | null;
  };
  subtitles: {
    /** external-vtt: sidecar file as WebVTT; extract-vtt: embedded text track converted by FFmpeg. */
    delivery: 'none' | 'external-vtt' | 'extract-vtt' | 'burn-in';
    index: number | null;
    lang: string | null;
  };
  /** Why this variant (shown in the TV tab diagnostics). */
  reasons: string[];
  /** The file cannot be played on this TV at all (e.g. DV profile 5 without a GPU tone mapper). */
  error: string | null;
}

/** Audio codecs that can be copied into fMP4 HLS segments. */
export const HLS_AUDIO_COPY = ['aac', 'ac3', 'eac3', 'mp3', 'flac', 'opus', 'alac'];
/** Video codecs that can be copied into fMP4 HLS segments. */
export const HLS_VIDEO_COPY = ['h264', 'hevc', 'av1', 'vp9'];
const TEXT_SUBTITLES = ['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'];

/** Audio as the profile names it (eac3 + JOC → eac3-joc, dts + HD → dts-hd). */
export function audioKind(a: AudioStream): string {
  if (a.codec === 'eac3' && a.atmos) return 'eac3-joc';
  if (a.codec === 'dts' && a.dtsHd) return 'dts-hd';
  return a.codec;
}

/** The TV can play this audio track as it is (decode or passthrough). Atmos/DTS-HD fall back to their core. */
export function audioPlayable(a: AudioStream, d: DeviceProfile): boolean {
  const kind = audioKind(a);
  const can = (c: string) => d.audioDecode.includes(c) || d.audioPassthrough.includes(c);
  if (can(kind)) return true;
  if (kind === 'eac3-joc') return can('eac3'); // JOC is backward compatible E-AC3 5.1
  if (kind === 'dts-hd') return can('dts'); // DTS-HD carries a DTS core
  return false;
}

function defaultAudio(probe: MediaProbe, wanted: number | null): AudioStream | null {
  if (wanted !== null) {
    const chosen = probe.audio.find((a) => a.index === wanted);
    if (chosen) return chosen;
  }
  return probe.audio.find((a) => a.isDefault) ?? probe.audio[0] ?? null;
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

const ENCODERS: Record<'nvenc' | 'qsv' | 'amf', { h264: string; hevc: string }> = {
  nvenc: { h264: 'h264_nvenc', hevc: 'hevc_nvenc' },
  qsv: { h264: 'h264_qsv', hevc: 'hevc_qsv' },
  amf: { h264: 'h264_amf', hevc: 'hevc_amf' },
};

export interface PlanInput {
  probe: MediaProbe;
  device: DeviceProfile;
  settings: TranscodeSettings;
  encoders: EncoderSupport;
  audioIndex?: number | null;
  subtitle?: SubtitleChoice;
}

export function planPlayback(input: PlanInput): PlaybackPlan {
  const { probe, device, settings, encoders } = input;
  const subtitle = input.subtitle ?? { kind: 'none' };
  const reasons: string[] = [];
  const v = probe.video;
  const a = defaultAudio(probe, input.audioIndex ?? null);

  // ------------------------------------------------ video
  let encodeVideo = false;
  let toneMap = false;
  let dvProfile5 = false;
  if (v) {
    const support = device.video.find((c) => c.codec === v.codec);
    if (!support) {
      encodeVideo = true;
      reasons.push(`video ${v.codec} is not supported by the TV`);
    } else {
      if (v.bitDepth > 8 && !support.tenBit) {
        encodeVideo = true;
        reasons.push(`${v.bitDepth}-bit ${v.codec} is not supported by the TV`);
      }
      const maxW = Math.min(support.maxWidth, device.maxWidth);
      const maxH = Math.min(support.maxHeight, device.maxHeight);
      if (v.width > maxW || v.height > maxH) {
        encodeVideo = true;
        reasons.push(`${v.width}×${v.height} is above the TV limit ${maxW}×${maxH}`);
      }
    }
    // Dynamic range.
    if (v.dolbyVision && !device.hdr.dolbyVision.includes(v.dolbyVision.profile)) {
      const dv = v.dolbyVision;
      const base = dv.blCompatibility;
      if (dv.profile === 5 || base === 0 || base === null) {
        // Profile 5 has no HDR10/SDR base layer (IPTPQc2 colors): only a tone mapper that applies the RPU helps.
        dvProfile5 = true;
        toneMap = true;
        reasons.push(`Dolby Vision profile ${dv.profile} without DV support on the TV → tone mapping to SDR`);
      } else if (base === 2) {
        reasons.push(`Dolby Vision profile ${dv.profile} plays as its SDR base layer`);
      } else if (base === 4) {
        if (!device.hdr.hlg) {
          toneMap = true;
          reasons.push(`Dolby Vision profile ${dv.profile} (HLG base) on a TV without HLG → tone mapping`);
        } else reasons.push(`Dolby Vision profile ${dv.profile} plays as HLG`);
      } else if (!device.hdr.hdr10) {
        toneMap = true;
        reasons.push(`Dolby Vision profile ${dv.profile} (HDR10 base) on a TV without HDR → tone mapping`);
      } else {
        reasons.push(`Dolby Vision profile ${dv.profile} plays as HDR10 (base layer)`);
      }
    } else if ((v.hdr === 'hdr10' || v.hdr === 'hdr10plus') && !device.hdr.hdr10) {
      toneMap = true;
      reasons.push(`${v.hdr === 'hdr10plus' ? 'HDR10+' : 'HDR10'} on a TV without HDR → tone mapping to SDR`);
    } else if (v.hdr === 'hlg' && !device.hdr.hlg) {
      toneMap = true;
      reasons.push('HLG on a TV without HLG → tone mapping to SDR');
    }
    if (toneMap) encodeVideo = true;
  }

  // ------------------------------------------------ subtitles
  let subDelivery: PlaybackPlan['subtitles']['delivery'] = 'none';
  let subIndex: number | null = null;
  let subLang: string | null = null;
  if (subtitle.kind === 'external') {
    subDelivery = 'external-vtt';
    subLang = subtitle.lang;
  } else if (subtitle.kind === 'embedded') {
    const s = probe.subtitles.find((x) => x.index === subtitle.index);
    if (s) {
      subIndex = s.index;
      subLang = s.language;
      if (s.image) {
        subDelivery = 'burn-in';
        if (v && !encodeVideo) reasons.push(`${s.codec} subtitles are images → burned into the video`);
        encodeVideo = true;
      } else if (TEXT_SUBTITLES.includes(s.codec)) {
        // Styled ASS keeps its look when the video is encoded anyway; otherwise plain text is enough.
        subDelivery = (s.codec === 'ass' || s.codec === 'ssa') && encodeVideo ? 'burn-in' : 'extract-vtt';
      }
    }
  }

  // ------------------------------------------------ audio
  let encodeAudio = false;
  if (a && !audioPlayable(a, device)) {
    encodeAudio = true;
    reasons.push(`audio ${audioKind(a)} is not supported by the TV`);
  }
  const containerOk = device.containers.includes(probe.container);
  const needsHls = encodeVideo || encodeAudio || !containerOk;
  if (needsHls && a && !encodeAudio && !HLS_AUDIO_COPY.includes(a.codec)) {
    // TrueHD/DTS cannot travel in fMP4 HLS segments.
    encodeAudio = true;
    reasons.push(`audio ${audioKind(a)} cannot be carried in HLS`);
  }
  if (needsHls && v && !encodeVideo && !HLS_VIDEO_COPY.includes(v.codec)) {
    encodeVideo = true;
    reasons.push(`video ${v.codec} cannot be carried in HLS`);
  }

  // ------------------------------------------------ result
  const mode: PlaybackMode = encodeVideo ? 'video' : encodeAudio ? 'audio' : containerOk ? 'direct' : 'remux';
  if (mode === 'direct') reasons.unshift('the TV plays the file as it is');
  if (mode === 'remux')
    reasons.unshift(`container ${probe.container} is not supported → remux to HLS (no quality loss)`);
  if (!device.hls && mode !== 'direct') {
    return {
      ...emptyPlan(mode, reasons),
      error: 'The TV cannot play HLS, and this file needs conversion.',
    };
  }

  const plan = emptyPlan(mode, reasons);
  plan.delivery = mode === 'direct' ? 'file' : 'hls';
  plan.subtitles = { delivery: subDelivery, index: subIndex, lang: subLang };

  if (v) {
    plan.video.index = v.index;
    plan.video.codec = v.codec;
    plan.video.width = v.width;
    plan.video.height = v.height;
    if (encodeVideo) {
      const maxH = Math.min(settings.maxHeight, device.maxHeight);
      const height = Math.min(v.height, maxH);
      const width = even((v.width * height) / v.height);
      const hevcOk = device.video.some((c) => c.codec === 'hevc') && encoders.hevc;
      // HEVC above 1080p (bandwidth), H.264 otherwise (plays everywhere).
      const codec = height > 1080 && hevcOk ? 'hevc' : 'h264';
      const hw = settings.hwAccel === 'cpu' ? null : encoders.hardware;
      plan.video.action = 'encode';
      plan.video.codec = codec;
      plan.video.encoder = hw ? ENCODERS[hw][codec] : codec === 'hevc' ? 'libx265' : 'libx264';
      plan.video.width = width;
      plan.video.height = height;
      const source = probe.bitrate ? Math.round(probe.bitrate / 1000) : null;
      const cap = settings.maxBitrateMbps * 1000;
      plan.video.bitrateKbps = Math.max(1500, Math.min(cap, source ?? cap));
      if (toneMap) {
        if (dvProfile5 && !encoders.libplacebo) {
          plan.error =
            'Dolby Vision profile 5 needs GPU tone mapping (libplacebo/Vulkan), which this PC does not have.';
        }
        plan.video.toneMap = encoders.libplacebo ? 'libplacebo' : 'zscale';
      }
      if (height < v.height) reasons.push(`scaled to ${height}p (limit)`);
      reasons.push(`video encoded with ${plan.video.encoder}`);
    }
  } else {
    plan.video.action = 'copy';
    plan.video.codec = 'none';
  }

  if (a) {
    plan.audio.index = a.index;
    plan.audio.codec = a.codec;
    plan.audio.channels = a.channels;
    plan.audio.action = 'copy';
    if (encodeAudio) {
      const can = (c: string) => device.audioDecode.includes(c) || device.audioPassthrough.includes(c);
      const surround = a.channels > 2 && device.maxAudioChannels > 2;
      if (surround && can('eac3')) {
        plan.audio.codec = 'eac3';
        plan.audio.channels = Math.min(6, a.channels, device.maxAudioChannels);
        plan.audio.bitrateKbps = 640;
        reasons.push(
          `audio → E-AC3 ${plan.audio.channels === 6 ? '5.1' : `${plan.audio.channels}ch`}${a.atmos ? ' (Atmos is not kept in conversion)' : ''}`,
        );
      } else {
        plan.audio.codec = 'aac';
        plan.audio.channels = Math.min(2, a.channels) || 2;
        plan.audio.bitrateKbps = 192;
        reasons.push(`audio → AAC stereo${a.atmos ? ' (Atmos is not kept in conversion)' : ''}`);
      }
      plan.audio.action = 'encode';
    } else if (a.atmos && device.audioPassthrough.includes(audioKind(a))) {
      reasons.push('Atmos kept (passthrough)');
    }
  } else {
    plan.audio.action = 'none';
    plan.audio.codec = 'none';
  }
  return plan;
}

function emptyPlan(mode: PlaybackMode, reasons: string[]): PlaybackPlan {
  return {
    mode,
    delivery: 'file',
    video: {
      index: null,
      action: 'copy',
      codec: '',
      encoder: null,
      toneMap: 'none',
      width: null,
      height: null,
      bitrateKbps: null,
    },
    audio: { index: null, action: 'copy', codec: '', channels: null, bitrateKbps: null },
    subtitles: { delivery: 'none', index: null, lang: null },
    reasons,
    error: null,
  };
}
