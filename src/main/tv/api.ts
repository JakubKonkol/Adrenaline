import { hostname } from 'node:os';
import type { z } from 'zod';
import { mediaTypeSchema } from '@shared/contracts/catalog';
import { catalogCollectionSchema } from '@shared/contracts/catalog';
import type { TvSubtitleChoices } from '@shared/contracts/tv';
import { rankSubtitles } from '@shared/domain/subtitle-ranking';
import type { SubtitleProviders } from '../services/subtitle-providers';
import { languageCodeSchema } from '@shared/contracts/settings';
import type { DownloadJob, JobProgress } from '@shared/contracts/downloads';
import type { ReleaseSession } from '@shared/contracts/releases';
import {
  pairingClaimSchema,
  pairingRequestSchema,
  TV_API_MIN,
  TV_API_VERSION,
  tvCreateDownloadSchema,
  tvDownloadActionSchema,
  type TvDownload,
  type TvInfo,
  type TvLibraryItem,
  type TvPlayback,
  tvPlaybackRequestSchema,
  type TvSubtitleTrack,
  type TvSession,
  tvProgressSchema,
  tvSelectionSchema,
} from '@shared/contracts/tv';
import { deriveJobStatus } from '@shared/domain/job-status';
import type { MediaProbe, PlaybackPlan } from '@shared/domain/playback';
import { AppError } from '@shared/errors';
import { stat as statFile } from 'node:fs/promises';
import { HLS_FILE, PLAYLIST } from '../media/ffmpeg-args';
import type { MediaService } from '../media/media-service';
import type { MediaRepository } from '../persistence/repositories/media';
import type { CatalogService } from '../services/catalog-service';
import type { DownloadService } from '../services/download-service';
import type { LibraryService } from '../services/library-service';
import type { ReleaseSearchService, SessionOwner } from '../services/release-search-service';
import type { SettingsService } from '../services/settings-service';
import type { TvDevicesRepository } from './devices';
import { readSubtitleAsVtt, sendFile, type TicketStore, videoMime } from './media';
import type { PairingManager } from './pairing';
import { HANDLED, type RequestContext, type Route } from './server';

/** What the API needs from the media layer (MediaService in the app, a stub in tests). */
export interface PlaybackApi {
  start: MediaService['start'];
  embeddedVtt: MediaService['embeddedVtt'];
  stopDevice: (deviceId: string) => void;
  /** VOD playlist of the device's session for this item. */
  hlsPlaylist: (sessionId: string, deviceId: string, itemId: string) => string;
  /** Path of an HLS segment of the device's session for this item (waits until FFmpeg wrote it). */
  hlsFile: (sessionId: string, deviceId: string, itemId: string, name: string) => Promise<string>;
}

export interface TvApiDeps {
  version: string;
  devices: TvDevicesRepository;
  pairing: PairingManager;
  tickets: TicketStore;
  catalog: CatalogService;
  releases: ReleaseSearchService;
  downloads: () => DownloadService | null;
  library: LibraryService;
  media: MediaRepository;
  settings: SettingsService;
  /** At least one enabled provider supports the languages configured on the PC. */
  subtitleAccountReady: () => boolean;
  subtitleProviders?: SubtitleProviders;
  /** Probe, plan and HLS sessions (D-85). */
  playback: PlaybackApi;
  /** A paired TV talked to the server (Deploy to TV waits for this). */
  onSeen?: (deviceId: string, address: string) => void;
  /** Lets a revoke end the device's open media streams. */
  trackStream: (deviceId: string, res: RequestContext['res']) => void;
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError('BAD_REQUEST', r.error.issues[0]?.message ?? 'invalid');
  return r.data;
}

const owner = (ctx: RequestContext): SessionOwner => `tv:${ctx.device!.id}`;
const MAX_RELEASES_FOR_TV = 300;
/** Treat the item as watched near the end: the next play starts from the beginning. */
const WATCHED_RATIO = 0.95;

function percentOf(job: DownloadJob, progress: JobProgress | undefined): number | null {
  const selected = job.files.filter((f) => f.selected);
  const total = progress?.selectedBytes || selected.reduce((a, f) => a + f.size, 0);
  const done = progress?.selectedDoneBytes ?? selected.reduce((a, f) => a + f.doneBytes, 0);
  return total > 0 ? Math.min(100, (done / total) * 100) : null;
}

/** Download as seen by a TV: no folder, hashes, links or subtitle paths. */
export function toTvDownload(job: DownloadJob, progress: JobProgress | undefined, media: MediaRepository): TvDownload {
  const t = job.target;
  const files = job.files.map((f) => ({
    ...f,
    doneBytes: progress?.files.find((p) => p.index === f.index)?.doneBytes ?? f.doneBytes,
  }));
  const status = deriveJobStatus(job, files, job.subtitles);
  const poster = media.lookup(t.kind === 'movie' ? 'movie' : 'tv', t.tmdbId).posterPath;
  return {
    id: job.id,
    kind: t.kind,
    tmdbId: t.tmdbId,
    title: t.title,
    year: t.year,
    season: t.kind === 'episode' ? t.season : null,
    episode: t.kind === 'episode' ? t.episode : null,
    posterPath: poster,
    releaseName: job.releaseName,
    state: job.state,
    status: status.kind,
    errorCode: job.errorCode,
    percent: status.filesComplete ? 100 : percentOf({ ...job, files }, progress),
    sizeBytes: job.totalBytes,
    downloadRate: progress?.live ? progress.downloadRate : 0,
    etaSeconds: progress?.live ? progress.etaSeconds : null,
    needsFileChoice: job.state === 'awaiting_file_selection',
    createdAt: job.createdAt,
  };
}

function trimSession(session: ReleaseSession): ReleaseSession {
  return { ...session, releases: session.releases.slice(0, MAX_RELEASES_FOR_TV) };
}

/** Routes of the TV API v1 (02-architecture-and-api.md). Local-only powers (folders, sources, secrets) are absent. */
export function tvRoutes(deps: TvApiDeps): Route[] {
  const subtitleChoices = new Map<string, TvSubtitleChoices>();
  const choicesKey = (ctx: RequestContext, sessionId: string, releaseId: string) => {
    const s = deps.settings.get();
    return JSON.stringify([
      owner(ctx),
      sessionId,
      releaseId,
      s.subtitleLang,
      s.subtitleFallbackLang,
      s.subtitleProviders,
    ]);
  };
  const requireDownloads = () => {
    const d = deps.downloads();
    if (!d) throw new AppError('ENGINE_UNAVAILABLE');
    return d;
  };
  const info = (): TvInfo => ({
    app: 'adrenaline',
    serverId: deps.devices.serverId(),
    serverName: hostname().slice(0, 60),
    version: deps.version,
    apiVersion: TV_API_VERSION,
    apiMin: TV_API_MIN,
  });
  const requireTicket = (ctx: RequestContext) => {
    const ticket = deps.tickets.use(ctx.params['ticket']!);
    if (!ticket || !deps.devices.exists(ticket.deviceId)) throw new AppError('TV_UNAUTHORIZED');
    return ticket;
  };
  const listDownloads = (): TvDownload[] => {
    const d = deps.downloads();
    if (!d) return [];
    const progress = new Map(d.progressSnapshot().map((p) => [p.jobId, p]));
    return d
      .list()
      .map((j) => toTvDownload(j, progress.get(j.id), deps.media))
      .sort((a, b) => b.createdAt - a.createdAt);
  };

  return [
    { method: 'GET', path: '/api/v1/info', auth: 'none', handler: info },
    {
      method: 'POST',
      path: '/api/v1/pairings',
      auth: 'none',
      strictLimit: true,
      handler: (ctx) => deps.pairing.request(parse(pairingRequestSchema, ctx.body), ctx.address),
    },
    {
      method: 'POST',
      path: '/api/v1/pairings/:id/claim',
      auth: 'none',
      handler: (ctx) => deps.pairing.claim(ctx.params['id']!, parse(pairingClaimSchema, ctx.body).claimSecret),
    },
    {
      method: 'GET',
      path: '/api/v1/session',
      auth: 'device',
      handler: (ctx) => {
        const version = ctx.query.get('clientVersion')?.slice(0, 40);
        deps.devices.seen(ctx.device!.id, ctx.address, version);
        deps.onSeen?.(ctx.device!.id, ctx.address);
        const session: TvSession = {
          device: { id: ctx.device!.id, name: ctx.device!.name },
          server: info(),
          features: { subtitles: deps.subtitleAccountReady() },
        };
        return session;
      },
    },

    // ------------------------------------------------------------ catalog
    {
      method: 'GET',
      path: '/api/v1/catalog/collection',
      auth: 'device',
      handler: (ctx) =>
        deps.catalog.collection(
          parse(mediaTypeSchema, ctx.query.get('type') ?? 'movie'),
          parse(catalogCollectionSchema, ctx.query.get('collection')),
        ),
    },
    {
      method: 'GET',
      path: '/api/v1/catalog/trending',
      auth: 'device',
      handler: (ctx) => deps.catalog.trending(parse(mediaTypeSchema, ctx.query.get('type') ?? 'movie')),
    },
    {
      method: 'GET',
      path: '/api/v1/catalog/search',
      auth: 'device',
      handler: (ctx) => {
        const q = (ctx.query.get('q') ?? '').slice(0, 300);
        const type = ctx.query.get('type');
        return deps.catalog.search(q, type ? parse(mediaTypeSchema, type) : undefined);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/catalog/:type/:id',
      auth: 'device',
      handler: (ctx) => deps.catalog.details(parse(mediaTypeSchema, ctx.params['type']), parseId(ctx.params['id'])),
    },
    {
      method: 'GET',
      path: '/api/v1/catalog/tv/:id/seasons/:n',
      auth: 'device',
      handler: (ctx) => deps.catalog.season(parseId(ctx.params['id']), parseSeason(ctx.params['n'])),
    },

    // ------------------------------------------------------------ releases
    {
      method: 'POST',
      path: '/api/v1/release-searches',
      auth: 'device',
      handler: async (ctx) => {
        // The PC resolves the title itself (trusted metadata); the TV only names it.
        const target = await deps.catalog.select(parse(tvSelectionSchema, ctx.body));
        return { sessionId: deps.releases.start(target, false, owner(ctx)) };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/release-searches/:id',
      auth: 'device',
      handler: (ctx) => {
        const id = ctx.params['id']!;
        if (deps.releases.ownerOf(id) !== owner(ctx)) throw new AppError('NOT_FOUND');
        return trimSession(deps.releases.session(id)!);
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/release-searches/:id',
      auth: 'device',
      handler: (ctx) => {
        const id = ctx.params['id']!;
        if (deps.releases.ownerOf(id) === owner(ctx)) deps.releases.cancel(id);
      },
    },

    // ------------------------------------------------------------ downloads
    {
      method: 'GET',
      path: '/api/v1/release-searches/:id/subtitles',
      auth: 'device',
      handler: async (ctx): Promise<TvSubtitleChoices> => {
        const id = ctx.params['id']!;
        const releaseId = ctx.query.get('releaseId') ?? '';
        if (deps.releases.ownerOf(id) !== owner(ctx)) throw new AppError('NOT_FOUND');
        const info = deps.releases.downloadInfo(id, releaseId);
        if (!info) throw new AppError('NOT_FOUND');
        const key = choicesKey(ctx, id, releaseId);
        const cached = subtitleChoices.get(key);
        if (cached) return cached;
        const settings = deps.settings.get();
        const languages = [
          settings.subtitleLang,
          ...(settings.subtitleFallbackLang ? [settings.subtitleFallbackLang] : []),
        ];
        const providers =
          deps.subtitleProviders?.available().filter((p) => p === 'opensubtitles' || languages.includes('pl')) ?? [];
        const result: TvSubtitleChoices = {
          candidates: [],
          providers,
          language: settings.subtitleLang,
          errorCode: null,
        };
        const target = info.target;
        try {
          result.candidates = rankSubtitles(
            (await deps.subtitleProviders?.search({
              languages,
              query: target.originalTitle,
              ...(target.kind === 'movie'
                ? { tmdbId: target.tmdbId }
                : { parentTmdbId: target.tmdbId, season: target.season, episode: target.episode }),
            })) ?? [],
            info.release.name,
          ).slice(0, 60);
        } catch (error) {
          result.errorCode = error instanceof AppError ? error.code : 'SUBS_UNAVAILABLE';
        }
        if (!result.errorCode) subtitleChoices.set(key, result);
        while (subtitleChoices.size > 100) subtitleChoices.delete(subtitleChoices.keys().next().value!);
        return result;
      },
    },
    { method: 'GET', path: '/api/v1/downloads', auth: 'device', handler: listDownloads },
    {
      method: 'POST',
      path: '/api/v1/downloads',
      auth: 'device',
      handler: async (ctx) => {
        const input = parse(tvCreateDownloadSchema, ctx.body);
        if (deps.releases.ownerOf(input.sessionId) !== owner(ctx)) throw new AppError('NOT_FOUND');
        const s = deps.settings.get();
        const subtitles = input.subtitles && deps.subtitleAccountReady();
        const choice =
          input.subtitleFileId === undefined
            ? undefined
            : subtitleChoices
                .get(choicesKey(ctx, input.sessionId, input.releaseId))
                ?.candidates.find((c) => c.fileId === input.subtitleFileId);
        if (input.subtitleFileId !== undefined && (!subtitles || !choice)) throw new AppError('BAD_REQUEST');
        if (input.subtitleProvider && !deps.subtitleProviders?.available().includes(input.subtitleProvider))
          throw new AppError('BAD_REQUEST');
        const job = await requireDownloads().create(
          { sessionId: input.sessionId, releaseId: input.releaseId },
          {
            // The folder is always chosen on the PC (default download folder); a TV never sends paths.
            subtitleLang: subtitles ? languageCodeSchema.parse(choice?.language ?? s.subtitleLang) : null,
            subtitleFallbackLang: subtitles ? s.subtitleFallbackLang : null,
            seedRatioLimit: null,
            seedTimeLimitMin: null,
            renameOnConflict: true,
            ...(choice ? { subtitleChoice: choice } : {}),
            ...(subtitles && input.subtitleProvider ? { subtitleProvider: input.subtitleProvider } : {}),
          },
        );
        return toTvDownload(job, undefined, deps.media);
      },
    },
    {
      method: 'POST',
      path: '/api/v1/downloads/:id/actions',
      auth: 'device',
      handler: async (ctx) => {
        const { action } = parse(tvDownloadActionSchema, ctx.body);
        const d = requireDownloads();
        const id = ctx.params['id']!;
        const job = action === 'pause' ? await d.pause(id) : await d.resume(id);
        return toTvDownload(job, undefined, deps.media);
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/downloads/:id',
      auth: 'device',
      // Files are never deleted from a TV; only the PC can do that.
      handler: async (ctx) => requireDownloads().remove(ctx.params['id']!, false),
    },

    // ------------------------------------------------------------ library and playback
    {
      method: 'GET',
      path: '/api/v1/library',
      auth: 'device',
      handler: async (ctx): Promise<TvLibraryItem[]> => {
        const progress = deps.devices.progress(ctx.device!.id);
        return (await deps.library.list()).map(({ jobId: _jobId, ...item }) => {
          const p = progress.get(item.id);
          // Watched to the end: not "continue watching" any more, the next play starts from the beginning.
          const watched = p?.durationMs ? p.positionMs >= p.durationMs * WATCHED_RATIO : false;
          return {
            ...item,
            resumeMs: p && !watched && p.positionMs > 5_000 ? p.positionMs : null,
            durationMs: p?.durationMs ?? null,
          };
        });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/playback/:itemId',
      auth: 'device',
      handler: async (ctx): Promise<TvPlayback> => {
        const req = parse(tvPlaybackRequestSchema, ctx.body);
        const deviceId = ctx.device!.id;
        const itemId = ctx.params['itemId']!;
        const saved = deps.devices.progress(deviceId).get(itemId);
        const savedResume =
          saved &&
          !(saved.durationMs && saved.positionMs >= saved.durationMs * WATCHED_RATIO) &&
          saved.positionMs > 5_000
            ? saved.positionMs
            : null;
        const started = await deps.playback.start({
          deviceId,
          itemId,
          profile: req.profile,
          ...(req.audioIndex !== undefined ? { audioIndex: req.audioIndex } : {}),
          ...(req.subtitle ? { subtitle: req.subtitle } : {}),
          // A converted stream starts where this TV stopped watching (the original file is sought by the player).
          startMs: req.startMs ?? savedResume ?? 0,
        });
        const { file, probe, plan, session } = started;
        if (plan.error) throw new AppError('TV_UNSUPPORTED_MEDIA', plan.error);
        const mime = videoMime(file.path);
        if (plan.delivery === 'file' && mime === 'application/octet-stream') throw new AppError('TV_UNSUPPORTED_MEDIA');
        const ticket = deps.tickets.issue(deviceId, file.item.id);
        const base = `http://${ctx.host}/media/${ticket}`;
        const p = deps.devices.progress(deviceId).get(file.item.id);
        const watched = p && p.durationMs ? p.positionMs >= p.durationMs * WATCHED_RATIO : false;
        const external: TvSubtitleTrack[] = file.subtitles
          .filter((x) => /\.(srt|vtt)$/i.test(x.path))
          .map((x) => ({
            id: `x:${x.lang}`,
            label: x.lang.toUpperCase(),
            kind: 'external',
            url: `${base}/subtitles/${encodeURIComponent(x.lang)}.vtt`,
            burnedIn: false,
            lang: x.lang,
          }));
        const embedded: TvSubtitleTrack[] = (probe?.subtitles ?? []).map((x) => ({
          id: `e:${x.index}`,
          label: [
            x.language?.toUpperCase() ?? `#${x.index}`,
            x.title,
            x.forced ? 'forced' : null,
            x.image ? (x.codec === 'hdmv_pgs_subtitle' ? 'PGS' : 'image') : null,
          ]
            .filter(Boolean)
            .join(' · '),
          kind: x.image ? 'embedded-image' : 'embedded-text',
          url: x.image ? null : `${base}/subtitles/e${x.index}.vtt`,
          burnedIn: plan.subtitles.delivery === 'burn-in' && plan.subtitles.index === x.index,
          lang: x.language,
        }));
        const audioTracks = (probe?.audio ?? []).map((a) => ({
          index: a.index,
          label: [a.language?.toUpperCase(), a.title, audioLabel(a.codec, a.profile), channels(a.channels)]
            .filter(Boolean)
            .join(' · '),
          selected: a.index === plan.audio.index,
        }));
        return {
          itemId: file.item.id,
          title:
            file.item.kind === 'episode'
              ? `${file.item.title} · S${String(file.item.season).padStart(2, '0')}E${String(file.item.episode).padStart(2, '0')}`
              : file.item.title,
          mode: plan.mode,
          streamUrl: session ? `${base}/hls/${session.id}/index.m3u8` : `${base}/video`,
          mimeType: session ? 'application/vnd.apple.mpegurl' : mime,
          durationMs: probe?.durationMs ?? null,
          resumeMs: p && !watched && p.positionMs > 5_000 ? p.positionMs : null,
          audioTracks,
          subtitleTracks: [...external, ...embedded],
          reasons: plan.reasons,
          source: describeSource(probe),
          output: describeOutput(plan),
        };
      },
    },
    {
      method: 'PUT',
      path: '/api/v1/playback/:itemId/progress',
      auth: 'device',
      handler: (ctx) => {
        const { positionMs, durationMs } = parse(tvProgressSchema, ctx.body);
        const itemId = ctx.params['itemId']!;
        if (!/^[\w-]{1,64}~\d{1,6}$/.test(itemId)) throw new AppError('BAD_REQUEST');
        deps.devices.saveProgress(ctx.device!.id, itemId, positionMs, durationMs);
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/playback',
      auth: 'device',
      // The TV left the player: stop its conversion at once (otherwise it stops after a minute without requests).
      handler: (ctx) => deps.playback.stopDevice(ctx.device!.id),
    },
    {
      method: 'GET',
      path: '/media/:ticket/video',
      auth: 'media',
      handler: async (ctx) => {
        const ticket = requireTicket(ctx);
        const file = await deps.library.resolve(ticket.itemId);
        deps.trackStream(ticket.deviceId, ctx.res);
        await sendFile(ctx.req, ctx.res, { ...file, mime: videoMime(file.path) });
        return HANDLED;
      },
    },
    {
      method: 'GET',
      path: '/media/:ticket/hls/:session/:file',
      auth: 'media',
      handler: async (ctx) => {
        const ticket = requireTicket(ctx);
        const name = ctx.params['file'] ?? '';
        if (!HLS_FILE.test(name)) throw new AppError('BAD_REQUEST');
        if (name === PLAYLIST) {
          const body = deps.playback.hlsPlaylist(ctx.params['session']!, ticket.deviceId, ticket.itemId);
          ctx.res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          ctx.res.setHeader('Cache-Control', 'no-store');
          ctx.res.end(ctx.req.method === 'HEAD' ? undefined : body);
          return HANDLED;
        }
        const path = await deps.playback.hlsFile(ctx.params['session']!, ticket.deviceId, ticket.itemId, name);
        const stat = await statFile(path);
        deps.trackStream(ticket.deviceId, ctx.res);
        await sendFile(ctx.req, ctx.res, {
          path,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          mime: 'video/mp2t',
        });
        return HANDLED;
      },
    },
    {
      method: 'GET',
      path: '/media/:ticket/subtitles/:file',
      auth: 'media',
      handler: async (ctx) => {
        const ticket = requireTicket(ctx);
        const name = ctx.params['file'] ?? '';
        const file = await deps.library.resolve(ticket.itemId);
        let vtt: string | null;
        const embedded = /^e(\d{1,3})\.vtt$/.exec(name);
        if (embedded) {
          vtt = await deps.playback.embeddedVtt(file, Number(embedded[1]));
        } else {
          const lang = /^([\w-]{1,16})\.vtt$/.exec(name)?.[1];
          const sub = file.subtitles.find((x) => x.lang === lang);
          vtt = sub ? await readSubtitleAsVtt(sub.path) : null;
        }
        if (vtt === null) throw new AppError('NOT_FOUND');
        ctx.res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        ctx.res.setHeader('Cache-Control', 'no-store');
        ctx.res.end(vtt);
        return HANDLED;
      },
    },
  ];
}

const VIDEO_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  vc1: 'VC-1',
};
const HDR_NAMES: Record<string, string> = { hdr10: 'HDR10', hdr10plus: 'HDR10+', hlg: 'HLG', sdr: 'SDR' };

function channels(n: number | null): string {
  return n === 6 ? '5.1' : n === 8 ? '7.1' : n === 2 ? 'stereo' : n ? `${n}ch` : '';
}

/** The file for the playback info panel: container, video, dynamic range. */
function describeSource(probe: MediaProbe | null): string {
  if (!probe) return 'unknown (not analysed)';
  const v = probe.video;
  return [
    probe.container.toUpperCase(),
    v ? [VIDEO_NAMES[v.codec] ?? v.codec.toUpperCase(), v.profile].filter(Boolean).join(' ') : null,
    v ? `${v.width}×${v.height}${v.frameRate ? ` ${Math.round(v.frameRate * 100) / 100} fps` : ''}` : null,
    v ? (v.dolbyVision ? `Dolby Vision ${v.dolbyVision.profile}` : (HDR_NAMES[v.hdr] ?? v.hdr)) : null,
    probe.bitrate ? `${Math.round(probe.bitrate / 100_000) / 10} Mb/s` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What the TV receives, for the playback info panel. */
function describeOutput(plan: PlaybackPlan): string {
  if (plan.delivery === 'file') return 'original file (direct play)';
  const v = plan.video;
  const a = plan.audio;
  return [
    'HLS (MPEG-TS)',
    v.action === 'copy'
      ? 'video copied'
      : `video → ${VIDEO_NAMES[v.codec] ?? v.codec} ${v.width ?? ''}×${v.height ?? ''} (${v.encoder ?? ''}${v.toneMap !== 'none' ? ', tone mapped' : ''})`,
    a.action === 'none'
      ? null
      : a.action === 'copy'
        ? 'audio copied'
        : `audio → ${audioLabel(a.codec, null)} ${channels(a.channels)}`,
    plan.subtitles.delivery === 'burn-in' ? 'subtitles burned in' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Codec name as people know it (TrueHD Atmos, DTS-HD MA, E-AC3 Atmos…). */
function audioLabel(codec: string, profile: string | null): string {
  if (profile && /atmos|DTS-HD|DTS:X/i.test(profile)) return profile.replace('Dolby Digital Plus', 'E-AC3');
  const names: Record<string, string> = {
    truehd: 'TrueHD',
    eac3: 'E-AC3',
    ac3: 'AC3',
    dts: 'DTS',
    aac: 'AAC',
    flac: 'FLAC',
    opus: 'Opus',
    mp3: 'MP3',
    mp2: 'MP2',
    vorbis: 'Vorbis',
    pcm_s16le: 'PCM',
    pcm_s24le: 'PCM',
  };
  return names[codec] ?? codec.toUpperCase();
}

function parseId(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError('BAD_REQUEST');
  return n;
}

function parseSeason(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000) throw new AppError('BAD_REQUEST');
  return n;
}
