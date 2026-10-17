import type { CatalogItem, SeasonDetails, TitleDetails } from '@shared/contracts/catalog';
import type { ReleaseSession } from '@shared/contracts/releases';
import type { CatalogCollection } from '@shared/contracts/catalog';
import type { TvSubtitleChoices } from '@shared/contracts/tv';
import type { SubtitleProvider } from '@shared/contracts/subtitles';
import type { DeviceProfile } from '@shared/domain/playback';
import type {
  PairingCreated,
  PairingStatus,
  TvDownload,
  TvInfo,
  TvLibraryItem,
  TvPlatform,
  TvPlayback,
  TvSession,
} from '@shared/contracts/tv';

/** Error from the PC (`code` from the API) or `NETWORK` when it could not be reached. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface PlaybackRequest {
  profile: DeviceProfile;
  audioIndex?: number | null;
  subtitle?: { kind: 'none' } | { kind: 'external'; lang: string } | { kind: 'embedded'; index: number };
  startMs?: number;
}

export type Selection =
  { type: 'movie'; tmdbId: number } | { type: 'tv'; tmdbId: number; season: number; episode: number };

const TIMEOUT_MS = 12_000;

async function request<T>(
  base: string,
  method: string,
  path: string,
  options: { token?: string | null; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const headers: Record<string, string> = {};
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      signal: controller.signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError('NETWORK', 0);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    throw new ApiError('BAD_RESPONSE', res.status);
  }
  if (!res.ok) {
    const code = (json as { error?: { code?: unknown } } | undefined)?.error?.code;
    throw new ApiError(typeof code === 'string' ? code : `HTTP_${res.status}`, res.status);
  }
  return json as T;
}

/** Calls before pairing (no token). */
export const publicApi = {
  info: (base: string) => request<TvInfo>(base, 'GET', '/api/v1/info', { timeoutMs: 6_000 }),
  pair: (base: string, deviceName: string, platform: TvPlatform) =>
    request<PairingCreated>(base, 'POST', '/api/v1/pairings', {
      body: { deviceName, platform, clientVersion: __TV_VERSION__ },
    }),
  claim: (base: string, pairingId: string, claimSecret: string) =>
    request<PairingStatus>(base, 'POST', `/api/v1/pairings/${encodeURIComponent(pairingId)}/claim`, {
      body: { claimSecret },
    }),
};

/** Paired API: every call carries the device token. */
export class Api {
  private revoked = false;

  constructor(
    readonly base: string,
    private readonly token: string,
    /** The PC no longer knows this token (revoked, or its data was reset): called once, the app pairs again. */
    private readonly onUnauthorized: () => void = () => undefined,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    try {
      return await request<T>(this.base, method, path, { token: this.token, body, timeoutMs });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TV_UNAUTHORIZED' && !this.revoked) {
        this.revoked = true;
        this.onUnauthorized();
      }
      throw error;
    }
  }

  session = () => this.call<TvSession>('GET', `/api/v1/session?clientVersion=${encodeURIComponent(__TV_VERSION__)}`);
  trending = (type: 'movie' | 'tv') => this.call<CatalogItem[]>('GET', `/api/v1/catalog/trending?type=${type}`);
  collection = (type: 'movie' | 'tv', collection: CatalogCollection) =>
    this.call<CatalogItem[]>('GET', `/api/v1/catalog/collection?type=${type}&collection=${collection}`);
  subtitleChoices = (sessionId: string, releaseId: string) =>
    this.call<TvSubtitleChoices>(
      'GET',
      `/api/v1/release-searches/${encodeURIComponent(sessionId)}/subtitles?releaseId=${encodeURIComponent(releaseId)}`,
      undefined,
      30_000,
    );
  search = (q: string) => this.call<CatalogItem[]>('GET', `/api/v1/catalog/search?q=${encodeURIComponent(q)}`);
  details = (type: 'movie' | 'tv', id: number) => this.call<TitleDetails>('GET', `/api/v1/catalog/${type}/${id}`);
  season = (id: number, n: number) => this.call<SeasonDetails>('GET', `/api/v1/catalog/tv/${id}/seasons/${n}`);
  startReleaseSearch = (selection: Selection) =>
    this.call<{ sessionId: string }>('POST', '/api/v1/release-searches', selection);
  releaseSession = (id: string) => this.call<ReleaseSession>('GET', `/api/v1/release-searches/${id}`);
  cancelReleaseSearch = (id: string) => this.call<void>('DELETE', `/api/v1/release-searches/${id}`);
  downloads = () => this.call<TvDownload[]>('GET', '/api/v1/downloads');
  createDownload = (
    sessionId: string,
    releaseId: string,
    subtitles: boolean,
    choice?: { subtitleFileId?: number; subtitleProvider?: SubtitleProvider },
  ) => this.call<TvDownload>('POST', '/api/v1/downloads', { sessionId, releaseId, subtitles, ...choice });
  downloadAction = (id: string, action: 'pause' | 'resume') =>
    this.call<TvDownload>('POST', `/api/v1/downloads/${id}/actions`, { action });
  removeDownload = (id: string) => this.call<void>('DELETE', `/api/v1/downloads/${id}`);
  library = () => this.call<TvLibraryItem[]>('GET', '/api/v1/library');
  playback = (itemId: string, request: PlaybackRequest) =>
    // The first playback of a file may analyse it on the PC (ffprobe, keyframe index): allow it time.
    this.call<TvPlayback>('POST', `/api/v1/playback/${encodeURIComponent(itemId)}`, request, 60_000);
  stopPlayback = () => this.call<void>('DELETE', '/api/v1/playback');
  saveProgress = (itemId: string, positionMs: number, durationMs: number | null) =>
    this.call<void>('PUT', `/api/v1/playback/${encodeURIComponent(itemId)}/progress`, {
      positionMs: Math.max(0, Math.round(positionMs)),
      durationMs: durationMs === null ? null : Math.round(durationMs),
    });
}

const IMAGE = /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/;

/** TMDB image URL (validated path), or null. */
export function image(path: string | null | undefined, size: 'w342' | 'w500' | 'w780' | 'w1280'): string | null {
  return path && IMAGE.test(path) ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}
