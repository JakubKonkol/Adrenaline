import type { PlaybackPlan } from '@shared/domain/playback';

export const SEGMENT_SECONDS = 6;
export const PLAYLIST = 'index.m3u8';
export const INIT_SEGMENT = 'init.mp4';
export const SEGMENT_PATTERN = 'seg%05d.m4s';
/** Text subtitles to burn in are extracted to this file in the session folder first (no paths in filters). */
export const BURN_IN_FILE = 'subs.ass';

export interface HlsJob {
  plan: PlaybackPlan;
  input: string;
  /** Start of the stream in the film (seek = new process from here). */
  startMs: number;
  /** Stream index of an image subtitle track to overlay (PGS/VobSub), when burning in. */
  imageSubtitleIndex: number | null;
  /** True when BURN_IN_FILE exists in the working directory (text subtitles to burn in). */
  textSubtitleFile: boolean;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** Video filter chain for an encode: tone mapping/scaling first, then subtitles drawn in SDR at the output size. */
function videoFilters(job: HlsJob): { graph: string; complex: boolean } {
  const v = job.plan.video;
  const w = v.width ?? -2;
  const h = v.height ?? -2;
  const steps: string[] = [];
  if (v.toneMap === 'libplacebo') {
    // libplacebo also applies Dolby Vision RPU reshaping (profile 5) before mapping to BT.709 SDR.
    steps.push(
      `libplacebo=w=${w}:h=${h}:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:tonemapping=bt.2390:format=yuv420p`,
    );
  } else if (v.toneMap === 'zscale') {
    steps.push(
      'zscale=t=linear:npl=100',
      'format=gbrpf32le',
      'zscale=p=bt709',
      'tonemap=tonemap=hable:desat=0',
      `zscale=t=bt709:m=bt709:r=tv:w=${w}:h=${h}`,
      'format=yuv420p',
    );
  } else {
    steps.push(`scale=${w}:${h}`, 'format=yuv420p');
  }
  if (job.textSubtitleFile) {
    // Input seeking restarts timestamps at 0: shift them so the subtitle timing matches the film.
    const offset = seconds(job.startMs);
    steps.push(`setpts=PTS+${offset}/TB`, `subtitles=${BURN_IN_FILE}`, `setpts=PTS-${offset}/TB`);
  }
  if (job.imageSubtitleIndex !== null) {
    return {
      graph: `[0:${v.index}]${steps.join(',')}[v0];[0:${job.imageSubtitleIndex}]scale=${w}:${h}[s0];[v0][s0]overlay=eof_action=pass,format=yuv420p[v]`,
      complex: true,
    };
  }
  return { graph: steps.join(','), complex: false };
}

function encoderArgs(plan: PlaybackPlan): string[] {
  const v = plan.video;
  const kbps = v.bitrateKbps ?? 8000;
  const rate = [`-b:v`, `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`];
  const gop = ['-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`];
  const enc = v.encoder ?? 'libx264';
  const hevcTag = v.codec === 'hevc' ? ['-tag:v', 'hvc1'] : [];
  if (enc.endsWith('_nvenc')) return ['-c:v', enc, '-preset', 'p5', '-rc', 'vbr', ...rate, ...gop, ...hevcTag];
  if (enc.endsWith('_qsv')) return ['-c:v', enc, '-preset', 'medium', ...rate, ...gop, ...hevcTag];
  if (enc.endsWith('_amf'))
    return ['-c:v', enc, '-quality', 'balanced', '-rc', 'vbr_peak', ...rate, ...gop, ...hevcTag];
  const crf = enc === 'libx265' ? '23' : '21';
  return [
    '-c:v',
    enc,
    '-preset',
    'veryfast',
    '-crf',
    crf,
    '-maxrate',
    `${kbps}k`,
    '-bufsize',
    `${kbps * 2}k`,
    ...gop,
    ...hevcTag,
  ];
}

/**
 * Arguments of the HLS (fMP4) job for a plan (D-85). Only values from the plan and our own file names go in; the input
 * path is a separate argument, never part of a filter. Run with cwd = the session folder.
 */
export function buildHlsArgs(job: HlsJob): string[] {
  const { plan } = job;
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-progress', 'pipe:1', '-nostats'];
  const encodeVideo = plan.video.action === 'encode';
  if (encodeVideo && plan.video.toneMap === 'libplacebo') args.push('-init_hw_device', 'vulkan');
  // GPU decoding where possible (frames come back to memory for the filters).
  if (encodeVideo) args.push('-hwaccel', 'auto');
  if (job.startMs > 0) args.push('-ss', seconds(job.startMs));
  args.push('-i', job.input);

  if (encodeVideo) {
    const filters = videoFilters(job);
    if (filters.complex) args.push('-filter_complex', filters.graph, '-map', '[v]');
    else args.push('-map', `0:${plan.video.index}`, '-vf', filters.graph);
    args.push(...encoderArgs(plan));
  } else if (plan.video.index !== null) {
    args.push('-map', `0:${plan.video.index}`, '-c:v', 'copy');
    if (plan.video.codec === 'hevc') args.push('-tag:v', 'hvc1');
    // Keeps the Dolby Vision configuration box when DV is copied.
    args.push('-strict', 'unofficial');
  }

  if (plan.audio.index !== null && plan.audio.action !== 'none') {
    args.push('-map', `0:${plan.audio.index}`);
    if (plan.audio.action === 'copy') args.push('-c:a', 'copy');
    else
      args.push(
        '-c:a',
        plan.audio.codec,
        '-b:a',
        `${plan.audio.bitrateKbps ?? 192}k`,
        '-ac',
        String(plan.audio.channels ?? 2),
      );
  } else {
    args.push('-an');
  }

  args.push(
    ...['-sn', '-dn', '-max_muxing_queue_size', '4096'],
    ...['-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_segment_type', 'fmp4'],
    ...['-hls_fmp4_init_filename', INIT_SEGMENT, '-hls_segment_filename', SEGMENT_PATTERN],
    ...['-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file', '-start_number', '0'],
    PLAYLIST,
  );
  return args;
}

/** Extracts one embedded text subtitle track as ASS (keeps styles) for burn-in. */
export function extractAssArgs(input: string, index: number): string[] {
  // The whole track: timing against a seek offset is aligned in the filter (setpts).
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-i',
    input,
    '-map',
    `0:${index}`,
    '-c:s',
    'ass',
    BURN_IN_FILE,
  ];
}

/** Embedded text subtitles as WebVTT on stdout (shown by the TV app). */
export function extractVttArgs(input: string, index: number): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-i',
    input,
    '-map',
    `0:${index}`,
    '-c:s',
    'webvtt',
    '-f',
    'webvtt',
    'pipe:1',
  ];
}
