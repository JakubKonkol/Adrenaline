import type { PlaybackPlan } from '@shared/domain/playback';

export const SEGMENT_SECONDS = 6;
/** The playlist the TV reads: generated for the whole film (VOD), never written by FFmpeg. */
export const PLAYLIST = 'index.m3u8';
/** FFmpeg lists every segment it has finished here (segment muxer, CSV); not served. */
export const SEGMENT_LIST = 'ffmpeg.csv';
/** Every file name a session may serve (playlist and MPEG-TS segments). */
export const HLS_FILE = /^(index\.m3u8|seg\d{5}\.ts)$/;
/** Text subtitles to burn in are extracted to this file in the session folder first (no paths in filters). */
export const BURN_IN_FILE = 'subs.ass';
/** One FFmpeg run gets at most this many cut times (the Windows command line has a length limit). */
const MAX_CUTS = 1500;

export function segmentName(n: number): string {
  return `seg${String(n).padStart(5, '0')}.ts`;
}

/**
 * The whole film as one VOD playlist, as Jellyfin does: players see the full duration and seek natively; a segment
 * far from what FFmpeg is writing restarts FFmpeg there (Transcoder). `starts` are the segment start times (ms).
 */
export function vodPlaylist(durationMs: number, starts: number[]): string {
  const lengths = starts.map((t, i) => ((starts[i + 1] ?? durationMs) - t) / 1000);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(SEGMENT_SECONDS, ...lengths))}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  lengths.forEach((length, n) => lines.push(`#EXTINF:${Math.max(0.001, length).toFixed(6)},`, segmentName(n)));
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

export interface HlsJob {
  plan: PlaybackPlan;
  input: string;
  /** Segment start times of the playlist (ms): keyframes for a copy, even steps for an encode. */
  starts: number[];
  /** First segment FFmpeg writes (a seek far away starts a new process from there). */
  startSegment: number;
  /** Stream index of an image subtitle track to overlay (PGS/VobSub), when burning in. */
  imageSubtitleIndex: number | null;
  /** True when BURN_IN_FILE exists in the working directory (text subtitles to burn in). */
  textSubtitleFile: boolean;
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
  // Timestamps are the film's own (-copyts), so the subtitle timing matches after any seek.
  if (job.textSubtitleFile) steps.push(`subtitles=${BURN_IN_FILE}`);
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
  // A keyframe at every segment boundary of the playlist: t counts from the start of this run, which is a boundary.
  const gop = ['-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`];
  const enc = v.encoder ?? 'libx264';
  if (enc.endsWith('_nvenc')) return ['-c:v', enc, '-preset', 'p5', '-rc', 'vbr', ...rate, '-forced-idr', '1', ...gop];
  if (enc.endsWith('_qsv')) return ['-c:v', enc, '-preset', 'medium', ...rate, ...gop];
  if (enc.endsWith('_amf')) return ['-c:v', enc, '-quality', 'balanced', '-rc', 'vbr_peak', ...rate, ...gop];
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
    // Forced keyframes must be IDR frames, or the HLS muxer does not cut there.
    ...['-forced-idr', '1', ...gop],
    // Scene cuts would add keyframes off the segment grid.
    ...(enc === 'libx264' ? ['-sc_threshold', '0'] : []),
  ];
}

/**
 * Arguments of the HLS job for a plan (D-85), from one segment of the VOD playlist on, as MPEG-TS segments (Samsung
 * AVPlay needs them; Media3 plays them too). The segment muxer cuts exactly at the playlist's segment starts, and
 * timestamps stay the film's own (-copyts -start_at_zero, as Jellyfin), so segments of different runs line up. Only
 * values from the plan and our own file names go in; the input path is a separate argument, never part of a filter.
 * Run with cwd = the session folder.
 */
export function buildHlsArgs(job: HlsJob): string[] {
  const { plan } = job;
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-progress', 'pipe:1', '-nostats'];
  const encodeVideo = plan.video.action === 'encode';
  if (encodeVideo && plan.video.toneMap === 'libplacebo') args.push('-init_hw_device', 'vulkan');
  // GPU decoding where possible (frames come back to memory for the filters).
  if (encodeVideo) args.push('-hwaccel', 'auto');
  const start = job.starts[job.startSegment] ?? 0;
  if (start > 0) {
    // A copy starts at the keyframe (index point) before the seek point, and FFmpeg seeks a little earlier still when
    // the video has B-frames: half a second past the segment's keyframe lands exactly on it (as Jellyfin does). An
    // encode seeks accurately.
    args.push('-ss', ((start + (encodeVideo ? 0 : 500)) / 1000).toFixed(3));
  }
  args.push('-i', job.input);

  if (encodeVideo) {
    const filters = videoFilters(job);
    if (filters.complex) args.push('-filter_complex', filters.graph, '-map', '[v]');
    else args.push('-map', `0:${plan.video.index}`, '-vf', filters.graph);
    args.push(...encoderArgs(plan));
  } else if (plan.video.index !== null) {
    args.push('-map', `0:${plan.video.index}`, '-c:v', 'copy');
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

  // Cut times relative to the start of this run (the segment muxer counts from its first packet).
  const cuts = job.starts.slice(job.startSegment + 1, job.startSegment + 1 + MAX_CUTS).map((t) => (t - start) / 1000);
  const last = job.starts[job.startSegment + 1 + MAX_CUTS];
  args.push(
    ...['-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1'],
    ...['-copyts', '-avoid_negative_ts', 'disabled', '-start_at_zero', '-max_muxing_queue_size', '4096'],
    // A very long film is written in parts: this run stops where its cut list ends.
    ...(last !== undefined ? ['-to', (last / 1000).toFixed(3)] : []),
    ...['-f', 'segment', '-segment_format', 'mpegts'],
    ...(cuts.length ? ['-segment_times', cuts.map((t) => t.toFixed(3)).join(',')] : []),
    ...['-segment_start_number', String(job.startSegment), '-reset_timestamps', '0'],
    ...['-segment_list', SEGMENT_LIST, '-segment_list_type', 'csv', '-segment_list_flags', '+live'],
    'seg%05d.ts',
  );
  return args;
}

/** Extracts one embedded text subtitle track as ASS (keeps styles) for burn-in. */
export function extractAssArgs(input: string, index: number): string[] {
  // The whole track: its timing is the film's, like the stream's (-copyts).
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
