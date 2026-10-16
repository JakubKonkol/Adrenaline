import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import type {
  AudioStream,
  DolbyVision,
  HdrFormat,
  MediaProbe,
  SubtitleStream,
  VideoStream,
} from '@shared/domain/playback';
import { AppError } from '@shared/errors';

/** Subset of ffprobe's JSON (`-show_format -show_streams`). */
interface RawSideData {
  side_data_type?: string;
  dv_profile?: number;
  dv_level?: number;
  dv_bl_signal_compatibility_id?: number;
  el_present_flag?: number;
}
interface RawStream {
  index: number;
  codec_name?: string;
  codec_type?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  color_primaries?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  channels?: number;
  disposition?: { default?: number; forced?: number; attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: RawSideData[];
}
export interface RawProbe {
  streams?: RawStream[];
  format?: { format_name?: string; duration?: string; bit_rate?: string; size?: string };
}
/** First video frame (`-show_frames`), for HDR10+ dynamic metadata. */
export interface RawFrames {
  frames?: { side_data_list?: { side_data_type?: string }[] }[];
}

const IMAGE_SUBTITLES = ['hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvb_subtitle', 'xsub'];

function container(formatName: string, path: string): string {
  const ext = extname(path).toLowerCase();
  if (formatName.includes('matroska')) return ext === '.webm' ? 'webm' : 'mkv';
  if (formatName.includes('mp4') || formatName.includes('mov')) return ext === '.mov' ? 'mov' : 'mp4';
  if (formatName.includes('mpegts')) return 'ts';
  if (formatName === 'avi') return 'avi';
  return formatName.split(',')[0] || 'other';
}

function rate(value: string | undefined): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(value ?? '');
  if (!m || Number(m[2]) === 0) return null;
  return Math.round((Number(m[1]) / Number(m[2])) * 1000) / 1000;
}

function bitDepth(s: RawStream): number {
  const fromRaw = Number(s.bits_per_raw_sample);
  if (fromRaw > 0) return fromRaw;
  const m = /p(\d{2})(le|be)?$/.exec(s.pix_fmt ?? '');
  return m ? Number(m[1]) : 8;
}

function dolbyVision(s: RawStream): DolbyVision | null {
  const dv = s.side_data_list?.find((d) => /DOVI configuration/i.test(d.side_data_type ?? ''));
  if (!dv || dv.dv_profile === undefined) return null;
  return {
    profile: dv.dv_profile,
    level: dv.dv_level ?? null,
    blCompatibility: dv.dv_bl_signal_compatibility_id ?? null,
    enhancementLayer: dv.el_present_flag === 1,
  };
}

function hdrOf(s: RawStream, dv: DolbyVision | null, hdr10plus: boolean): HdrFormat {
  if (s.color_transfer === 'smpte2084') return hdr10plus ? 'hdr10plus' : 'hdr10';
  if (s.color_transfer === 'arib-std-b67') return 'hlg';
  if (dv) return 'dv'; // profile 5: no HDR10 signalling in the stream itself
  return 'sdr';
}

const lang = (s: RawStream) => {
  const l = s.tags?.['language'] ?? s.tags?.['LANGUAGE'];
  return l && l !== 'und' ? l : null;
};
const title = (s: RawStream) => s.tags?.['title'] ?? s.tags?.['TITLE'] ?? null;

/** ffprobe JSON → MediaProbe (D-85). `frames` (first video frame) adds HDR10+ detection. */
export function parseProbe(raw: RawProbe, path: string, sizeBytes: number, frames?: RawFrames): MediaProbe {
  const streams = raw.streams ?? [];
  const hdr10plus = (frames?.frames?.[0]?.side_data_list ?? []).some((d) =>
    /SMPTE2094-40|HDR10\+/i.test(d.side_data_type ?? ''),
  );
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  let video: VideoStream | null = null;
  if (v && v.codec_name) {
    const dv = dolbyVision(v);
    video = {
      index: v.index,
      codec: v.codec_name,
      profile: v.profile ?? null,
      level: v.level ?? null,
      width: v.width ?? 0,
      height: v.height ?? 0,
      bitDepth: bitDepth(v),
      frameRate: rate(v.avg_frame_rate) ?? rate(v.r_frame_rate),
      hdr: hdrOf(v, dv, hdr10plus),
      hdr10plus,
      dolbyVision: dv,
    };
  }
  const audio: AudioStream[] = streams
    .filter((s) => s.codec_type === 'audio' && s.codec_name)
    .map((s) => ({
      index: s.index,
      codec: s.codec_name!,
      profile: s.profile ?? null,
      channels: s.channels ?? 2,
      language: lang(s),
      title: title(s),
      isDefault: s.disposition?.default === 1,
      atmos: /atmos|joc/i.test(s.profile ?? ''),
      dtsHd: s.codec_name === 'dts' && /DTS-HD|DTS:X/i.test(s.profile ?? ''),
    }));
  const subtitles: SubtitleStream[] = streams
    .filter((s) => s.codec_type === 'subtitle' && s.codec_name)
    .map((s) => ({
      index: s.index,
      codec: s.codec_name!,
      language: lang(s),
      title: title(s),
      isDefault: s.disposition?.default === 1,
      forced: s.disposition?.forced === 1,
      image: IMAGE_SUBTITLES.includes(s.codec_name!),
    }));
  const duration = Number(raw.format?.duration);
  const bitrate = Number(raw.format?.bit_rate);
  return {
    container: container(raw.format?.format_name ?? '', path),
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
    sizeBytes,
    video,
    audio,
    subtitles,
  };
}

const MAX_OUTPUT = 4 * 1024 * 1024;

/** Runs a tool with fixed arguments (no shell), a timeout and an output limit; resolves with stdout. */
export function runTool(exe: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_OUTPUT) child.kill();
      else chunks.push(d);
    });
    child.stderr.resume();
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new AppError('TV_UNSUPPORTED_MEDIA', `exit ${code ?? 'killed'}`));
    });
  });
}

/** ffprobe of one file; HDR10+ needs a look at the first frame (only for PQ HEVC/AV1). */
export async function probeFile(ffprobe: string, path: string, sizeBytes: number): Promise<MediaProbe> {
  const out = await runTool(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-i', path],
    30_000,
  );
  const raw = JSON.parse(out) as RawProbe;
  const v = raw.streams?.find((s) => s.codec_type === 'video');
  let frames: RawFrames | undefined;
  if (v && v.color_transfer === 'smpte2084' && (v.codec_name === 'hevc' || v.codec_name === 'av1')) {
    try {
      const f = await runTool(
        ffprobe,
        [
          ...['-v', 'error', '-print_format', 'json', '-select_streams', 'v:0'],
          ...['-read_intervals', '%+#1', '-show_frames', '-show_entries', 'frame=side_data_list', '-i', path],
        ],
        30_000,
      );
      frames = JSON.parse(f) as RawFrames;
    } catch {
      /* HDR10+ is optional: HDR10 still applies */
    }
  }
  return parseProbe(raw, path, sizeBytes, frames);
}
