import type { EncoderSupport, HwAccel } from '@shared/domain/playback';
import type { Logger } from '../logger';
import { runTool } from './probe';

/** Runs ffmpeg with arguments; resolves when it exits with 0. */
export type ToolRunner = (args: string[]) => Promise<unknown>;

const FAMILIES = ['nvenc', 'qsv', 'amf'] as const;

/** One encoded frame: an encoder is listed by every build but works only with the matching GPU and driver. */
const testEncode = (encoder: string) => [
  ...['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2'],
  ...['-frames:v', '1', '-c:v', encoder, '-f', 'null', '-'],
];

const testLibplacebo = [
  ...['-hide_banner', '-v', 'error', '-init_hw_device', 'vulkan', '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.1'],
  ...['-vf', 'libplacebo=w=64:h=64:format=yuv420p', '-frames:v', '1', '-f', 'null', '-'],
];

/**
 * Which encoders work on this PC (D-85): the requested hardware family (or the first working one for `auto`), HEVC
 * support and GPU tone mapping. Results are cached per preference for the app session.
 */
export class EncoderDetector {
  private cache = new Map<HwAccel, Promise<EncoderSupport>>();

  constructor(
    private readonly run: ToolRunner,
    private readonly log: Logger,
  ) {}

  static forFfmpeg(ffmpeg: string, log: Logger): EncoderDetector {
    return new EncoderDetector((args) => runTool(ffmpeg, args, 20_000), log);
  }

  private async works(args: string[]): Promise<boolean> {
    try {
      await this.run(args);
      return true;
    } catch {
      return false;
    }
  }

  detect(preference: HwAccel): Promise<EncoderSupport> {
    let result = this.cache.get(preference);
    if (!result) {
      result = this.detectNow(preference);
      this.cache.set(preference, result);
    }
    return result;
  }

  private async detectNow(preference: HwAccel): Promise<EncoderSupport> {
    let hardware: EncoderSupport['hardware'] = null;
    const candidates = preference === 'auto' ? FAMILIES : preference === 'cpu' ? [] : [preference];
    for (const family of candidates) {
      if (await this.works(testEncode(`h264_${family}`))) {
        hardware = family;
        break;
      }
    }
    if (preference !== 'auto' && preference !== 'cpu' && !hardware)
      this.log.warn(`${preference} was chosen but does not work on this PC: using the CPU`);
    const hevc = hardware ? await this.works(testEncode(`hevc_${hardware}`)) : await this.works(testEncode('libx265'));
    const libplacebo = await this.works(testLibplacebo);
    const support = { hardware, hevc, libplacebo };
    this.log.info(`encoders: ${JSON.stringify(support)}`);
    return support;
  }
}
