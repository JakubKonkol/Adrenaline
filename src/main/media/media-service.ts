import { join } from 'node:path';
import type { DeviceProfile, EncoderSupport, MediaProbe, PlaybackPlan, SubtitleChoice } from '@shared/domain/playback';
import { planPlayback } from '@shared/domain/playback';
import { AppError } from '@shared/errors';
import type { Logger } from '../logger';
import type { LibraryService, ResolvedLibraryFile } from '../services/library-service';
import type { SettingsService } from '../services/settings-service';
import { extractVttArgs, SEGMENT_SECONDS } from './ffmpeg-args';
import type { FfmpegTools } from './ffmpeg-path';
import type { Database } from '../persistence/db';
import { EncoderDetector } from './hwaccel';
import { KeyframeIndex, segmentStarts } from './keyframes';
import { ProbeCache } from './probe-cache';
import { probeFile, runTool } from './probe';
import { runFfmpegIn, spawnFfmpeg, type TranscodeSession, Transcoder } from './transcoder';

export interface MediaServiceDeps {
  library: LibraryService;
  settings: SettingsService;
  cache: ProbeCache;
  /** Null when FFmpeg is missing: TVs then get direct play only. */
  tools: FfmpegTools | null;
  detector: EncoderDetector | null;
  transcoder: Transcoder | null;
  log: Logger;
  probe?: (ffprobe: string, path: string, size: number) => Promise<MediaProbe>;
  /** Keyframes of files whose video is copied (HLS segments start there). */
  keyframes?: KeyframeIndex | null;
}

export interface PlaybackStart {
  file: ResolvedLibraryFile;
  probe: MediaProbe | null;
  plan: PlaybackPlan;
  session: TranscodeSession | null;
}

/** What a TV played and why (TV tab diagnostics). */
export interface PlaybackRecord {
  deviceId: string;
  itemId: string;
  title: string;
  mode: PlaybackPlan['mode'];
  reasons: string[];
  encoder: string | null;
  toneMap: PlaybackPlan['video']['toneMap'];
  sessionId: string | null;
  startedAt: number;
}

const NO_ENCODERS: EncoderSupport = { hardware: null, hevc: false, libplacebo: false };

/** Library file → ffprobe (cached) → plan for the TV → direct file or an HLS session (D-85). */
export class MediaService {
  private recent: PlaybackRecord[] = [];

  constructor(private readonly deps: MediaServiceDeps) {}

  get available(): boolean {
    return this.deps.tools !== null;
  }

  async probe(file: ResolvedLibraryFile): Promise<MediaProbe | null> {
    const tools = this.deps.tools;
    if (!tools) return null;
    const cached = this.deps.cache.get(file.item.id, file.size, file.mtimeMs);
    if (cached) return cached;
    try {
      const probe = await (this.deps.probe ?? probeFile)(tools.ffprobe, file.path, file.size);
      this.deps.cache.set(file.item.id, file.size, file.mtimeMs, probe);
      return probe;
    } catch (error) {
      this.deps.log.warn(`ffprobe failed for ${file.item.id}`, error);
      return null;
    }
  }

  async start(input: {
    deviceId: string;
    itemId: string;
    profile: DeviceProfile;
    audioIndex?: number | null;
    subtitle?: SubtitleChoice;
    startMs?: number;
  }): Promise<PlaybackStart> {
    const file = await this.deps.library.resolve(input.itemId);
    const probe = await this.probe(file);
    const s = this.deps.settings.get();
    let plan: PlaybackPlan;
    if (!probe) {
      // Without FFmpeg (or an unreadable file) the TV gets the original file and decides itself.
      plan = {
        mode: 'direct',
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
        subtitles: {
          delivery: input.subtitle?.kind === 'external' ? 'external-vtt' : 'none',
          index: null,
          lang: input.subtitle?.kind === 'external' ? input.subtitle.lang : null,
        },
        reasons: [
          this.deps.tools ? 'the file could not be analysed: sent as it is' : 'FFmpeg is missing: sent as it is',
        ],
        error: null,
      };
    } else {
      const encoders = this.deps.detector ? await this.deps.detector.detect(s.transcodeHwAccel) : NO_ENCODERS;
      plan = planPlayback({
        probe,
        device: input.profile,
        settings: {
          hwAccel: s.transcodeHwAccel,
          maxHeight: s.transcodeMaxHeight,
          maxBitrateMbps: s.transcodeMaxBitrateMbps,
        },
        encoders,
        audioIndex: input.audioIndex ?? null,
        subtitle: input.subtitle ?? { kind: 'none' },
      });
    }
    let session: TranscodeSession | null = null;
    if (!plan.error && plan.delivery === 'hls') {
      if (!this.deps.transcoder) throw new Error('transcoder missing');
      // The VOD playlist needs the length of the film (ffprobe gives it for every file it can read).
      if (!probe?.durationMs) throw new AppError('TV_UNSUPPORTED_MEDIA', 'unknown duration');
      // A copied video can only be cut at its keyframes: the segments start there.
      const keyframes =
        plan.video.action === 'copy' && plan.video.index !== null && this.deps.keyframes
          ? await this.deps.keyframes.get({
              path: file.path,
              container: probe.container,
              sizeBytes: file.size,
              mtimeMs: file.mtimeMs,
              itemId: file.item.id,
            })
          : null;
      if (plan.video.action === 'copy' && plan.video.index !== null && !keyframes)
        this.deps.log.warn(`no keyframes for ${file.item.id}: even segments, seeking may be off`);
      session = await this.deps.transcoder.start({
        deviceId: input.deviceId,
        itemId: input.itemId,
        input: file.path,
        plan,
        durationMs: probe.durationMs,
        starts: segmentStarts(probe.durationMs, SEGMENT_SECONDS * 1000, keyframes),
        startMs: Math.max(0, Math.round(input.startMs ?? 0)),
      });
    } else {
      // Direct play replaces whatever this TV was converting before.
      this.deps.transcoder?.stopDevice(input.deviceId);
    }
    this.record({
      deviceId: input.deviceId,
      itemId: input.itemId,
      title: file.item.title,
      mode: plan.mode,
      reasons: plan.error ? [...plan.reasons, plan.error] : plan.reasons,
      encoder: plan.video.encoder,
      toneMap: plan.video.toneMap,
      sessionId: session?.id ?? null,
      startedAt: Date.now(),
    });
    return { file, probe, plan, session };
  }

  private record(r: PlaybackRecord) {
    this.recent = [r, ...this.recent.filter((x) => x.deviceId !== r.deviceId)].slice(0, 10);
  }

  recentPlaybacks(): (PlaybackRecord & { speed: number | null; active: boolean })[] {
    const sessions = this.deps.transcoder?.list() ?? [];
    return this.recent.map((r) => {
      const s = r.sessionId ? sessions.find((x) => x.id === r.sessionId) : undefined;
      return { ...r, speed: s?.speed ?? null, active: !!s && s.runningFrom !== null };
    });
  }

  /** Embedded text subtitles of a library item as WebVTT (cached on disk next to nothing: small and fast). */
  async embeddedVtt(file: ResolvedLibraryFile, index: number): Promise<string | null> {
    const tools = this.deps.tools;
    if (!tools) return null;
    try {
      return await runTool(tools.ffmpeg, extractVttArgs(file.path, index), 60_000);
    } catch {
      return null;
    }
  }

  private ownSession(sessionId: string, deviceId: string, itemId: string) {
    const transcoder = this.deps.transcoder;
    const session = transcoder?.get(sessionId);
    if (!transcoder || !session || session.deviceId !== deviceId || session.itemId !== itemId)
      throw new AppError('NOT_FOUND');
    return { transcoder, session };
  }

  /** The VOD playlist of a session, only for the TV and item that started it. */
  hlsPlaylist(sessionId: string, deviceId: string, itemId: string): string {
    const { transcoder, session } = this.ownSession(sessionId, deviceId, itemId);
    return transcoder.playlist(session);
  }

  /** A segment (or fMP4 init) of a session, only for the TV and item that started it; waits until FFmpeg wrote it. */
  async hlsFile(sessionId: string, deviceId: string, itemId: string, name: string): Promise<string> {
    const { transcoder, session } = this.ownSession(sessionId, deviceId, itemId);
    return transcoder.file(session, name);
  }

  stopDevice(deviceId: string): void {
    this.deps.transcoder?.stopDevice(deviceId);
  }

  stopAll(): void {
    this.deps.transcoder?.stopAll();
  }
}

/** Builds the media layer: probe cache, encoder detection and the HLS transcoder (when FFmpeg is there). */
export function createMediaService(opts: {
  userData: string;
  db: Database;
  library: LibraryService;
  settings: SettingsService;
  tools: FfmpegTools | null;
  log: Logger;
}): MediaService {
  const { tools, log } = opts;
  return new MediaService({
    library: opts.library,
    settings: opts.settings,
    cache: new ProbeCache(opts.db),
    tools,
    detector: tools ? EncoderDetector.forFfmpeg(tools.ffmpeg, log) : null,
    keyframes: tools ? new KeyframeIndex({ dir: join(opts.userData, 'keyframes'), ffprobe: tools.ffprobe, log }) : null,
    transcoder: tools
      ? new Transcoder({
          cacheDir: join(opts.userData, 'transcode'),
          spawn: spawnFfmpeg(tools.ffmpeg),
          runFfmpeg: runFfmpegIn(tools.ffmpeg),
          log,
          cacheLimitBytes: () => opts.settings.get().transcodeCacheGiB * 1024 ** 3,
        })
      : null,
    log,
  });
}
