import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface FfmpegTools {
  ffmpeg: string;
  ffprobe: string;
}

/**
 * FFmpeg binaries (D-85): ADRENALINE_FFMPEG_DIR (dev/tests) → resources/ffmpeg (installer) → vendor/ffmpeg (dev, from
 * scripts/fetch-ffmpeg.mjs). Null when missing: the TV then gets direct play only.
 */
export function resolveFfmpeg(opts: {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
  platform?: NodeJS.Platform;
}): FfmpegTools | null {
  const exe = (opts.platform ?? process.platform) === 'win32' ? '.exe' : '';
  const dirs = opts.isPackaged
    ? [join(opts.resourcesPath, 'ffmpeg')]
    : [opts.env['ADRENALINE_FFMPEG_DIR'], join(opts.appRoot, 'vendor', 'ffmpeg')].filter((d): d is string => !!d);
  for (const dir of dirs) {
    const tools = { ffmpeg: join(dir, `ffmpeg${exe}`), ffprobe: join(dir, `ffprobe${exe}`) };
    if (existsSync(tools.ffmpeg) && existsSync(tools.ffprobe)) return tools;
  }
  return null;
}
