import { hostname } from 'node:os';
import type { z } from 'zod';
import { mediaTypeSchema } from '@shared/contracts/catalog';
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
  type TvSession,
  tvProgressSchema,
  tvSelectionSchema,
} from '@shared/contracts/tv';
import { deriveJobStatus } from '@shared/domain/job-status';
import { AppError } from '@shared/errors';
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
  /** OpenSubtitles account saved on the PC (D-78): only then a TV can ask for subtitles. */
  subtitleAccountReady: () => boolean;
  /** Lets a revoke end the device's open media streams. */
  trackStream: (deviceId: string, res: RequestContext['res']) => void;
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError('BAD_REQUEST', r.error.issues[0]?.message ?? 'invalid');
  return r.data;
}

const owner = (ctx: RequestContext): SessionOwner => `tv:${ctx.device!.id}`;
const MAX_RELEASES_FOR_TV = 60;
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
        const job = await requireDownloads().create(
          { sessionId: input.sessionId, releaseId: input.releaseId },
          {
            // The folder is always chosen on the PC (default download folder); a TV never sends paths.
            subtitleLang: subtitles ? s.subtitleLang : null,
            subtitleFallbackLang: subtitles ? s.subtitleFallbackLang : null,
            seedRatioLimit: null,
            seedTimeLimitMin: null,
            renameOnConflict: true,
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
          return { ...item, resumeMs: p?.positionMs ?? null, durationMs: p?.durationMs ?? null };
        });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/playback/:itemId',
      auth: 'device',
      handler: async (ctx): Promise<TvPlayback> => {
        const file = await deps.library.resolve(ctx.params['itemId']!);
        const mime = videoMime(file.path);
        if (mime === 'application/octet-stream') throw new AppError('TV_UNSUPPORTED_MEDIA');
        const ticket = deps.tickets.issue(ctx.device!.id, file.item.id);
        const base = `http://${ctx.host}/media/${ticket}`;
        const p = deps.devices.progress(ctx.device!.id).get(file.item.id);
        const watched = p && p.durationMs ? p.positionMs >= p.durationMs * WATCHED_RATIO : false;
        return {
          itemId: file.item.id,
          title:
            file.item.kind === 'episode'
              ? `${file.item.title} · S${String(file.item.season).padStart(2, '0')}E${String(file.item.episode).padStart(2, '0')}`
              : file.item.title,
          streamUrl: `${base}/video`,
          mimeType: mime,
          subtitles: file.subtitles
            .filter((s) => /\.(srt|vtt)$/i.test(s.path))
            .map((s) => ({ lang: s.lang, url: `${base}/subtitles/${encodeURIComponent(s.lang)}.vtt` })),
          resumeMs: p && !watched && p.positionMs > 5_000 ? p.positionMs : null,
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
      method: 'GET',
      path: '/media/:ticket/video',
      auth: 'media',
      handler: async (ctx) => {
        const ticket = deps.tickets.use(ctx.params['ticket']!);
        if (!ticket || !deps.devices.exists(ticket.deviceId)) throw new AppError('TV_UNAUTHORIZED');
        const file = await deps.library.resolve(ticket.itemId);
        deps.trackStream(ticket.deviceId, ctx.res);
        await sendFile(ctx.req, ctx.res, { ...file, mime: videoMime(file.path) });
        return HANDLED;
      },
    },
    {
      method: 'GET',
      path: '/media/:ticket/subtitles/:file',
      auth: 'media',
      handler: async (ctx) => {
        const ticket = deps.tickets.use(ctx.params['ticket']!);
        if (!ticket || !deps.devices.exists(ticket.deviceId)) throw new AppError('TV_UNAUTHORIZED');
        const lang = /^([\w-]{1,16})\.vtt$/.exec(ctx.params['file'] ?? '')?.[1];
        const file = await deps.library.resolve(ticket.itemId);
        const sub = file.subtitles.find((s) => s.lang === lang);
        const vtt = sub ? await readSubtitleAsVtt(sub.path) : null;
        if (vtt === null) throw new AppError('NOT_FOUND');
        ctx.res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        ctx.res.setHeader('Cache-Control', 'no-store');
        ctx.res.end(vtt);
        return HANDLED;
      },
    },
  ];
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
