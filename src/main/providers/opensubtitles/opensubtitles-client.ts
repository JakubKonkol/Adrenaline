import { z } from 'zod';
import { AppError } from '@shared/errors';
import { readBodyLimited } from '../http';

import type { SubtitleCandidate, SubtitleProvider } from '@shared/contracts/subtitles';
export type { SubtitleCandidate } from '@shared/contracts/subtitles';

export interface SubtitleQuery {
  provider?: SubtitleProvider;
  videoPath?: string;
  tmdbId?: number;
  parentTmdbId?: number;
  season?: number;
  episode?: number;
  languages: string[];
  moviehash?: string | null;
  query?: string | null;
}

export interface DownloadLink {
  link: string;
  fileName: string;
  remaining: number | null;
  resetTimeUtc: number | null;
}

interface Session {
  token: string;
  baseUrl: string;
  expiresAt: number;
}

export interface OpenSubtitlesOptions {
  apiKey: () => string | null;
  username: () => string | null;
  password: () => string | null;
  /** Session token storage (a secret, never logged). */
  session: { get: () => string | null; set: (value: string | null) => void };
  userAgent: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const DEFAULT_BASE = 'api.opensubtitles.com';
const API_HOSTS = new Set([DEFAULT_BASE, 'vip-api.opensubtitles.com']);
const FILE_HOSTS = new Set(['www.opensubtitles.com', 'dl.opensubtitles.com', 'dl.opensubtitles.org']);
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

const loginSchema = z.object({
  token: z.string().min(1),
  base_url: z.string().optional(),
  user: z.object({ allowed_downloads: z.number().optional() }).partial().optional(),
});
const searchSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      attributes: z.object({
        language: z.string().nullable().optional(),
        release: z.string().nullable().optional(),
        hearing_impaired: z.boolean().optional(),
        foreign_parts_only: z.boolean().optional(),
        moviehash_match: z.boolean().optional(),
        download_count: z.number().optional(),
        ratings: z.number().optional(),
        from_trusted: z.boolean().nullable().optional(),
        machine_translated: z.boolean().nullable().optional(),
        files: z.array(z.object({ file_id: z.number(), file_name: z.string().nullable().optional() })).default([]),
      }),
    }),
  ),
});
const downloadSchema = z.object({
  link: z.string().url(),
  file_name: z.string(),
  remaining: z.number().optional(),
  reset_time_utc: z.string().optional(),
});
const quotaSchema = z.object({ remaining: z.number().optional(), reset_time_utc: z.string().optional() }).passthrough();
const userInfoSchema = z.object({
  data: z.object({
    allowed_downloads: z.number().optional(),
    remaining_downloads: z.number().optional(),
    level: z.string().optional(),
  }),
});

/** JWT expiry (exp claim); OpenSubtitles tokens last about 24 h. */
function jwtExpiry(token: string, now: number): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (payload.exp) return payload.exp * 1000;
  } catch {
    /* not a JWT */
  }
  return now + 23 * 60 * 60 * 1000;
}

/**
 * OpenSubtitles.com REST client (D-61, checked against the official OpenAPI document 15.10.2026). Parameters are
 * lowercase and alphabetically sorted, redirects are followed, later requests go to the `base_url` from login.
 * 401 → one new login → SUBS_AUTH; quota → SUBS_QUOTA with the reset time; 5xx/network → SUBS_UNAVAILABLE after up
 * to 3 tries, except /download, which is never repeated automatically (it is what counts against the quota).
 */
export class OpenSubtitlesClient {
  private signingIn: Promise<Session> | null = null;
  private generation = 0;
  private abort = new AbortController();
  private authBlocked = false;
  constructor(private readonly opts: OpenSubtitlesOptions) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private apiKey(): string {
    const key = this.opts.apiKey()?.trim();
    if (!key) throw new AppError('SUBS_NO_KEY');
    return key;
  }

  private headers(token?: string): Record<string, string> {
    return {
      'Api-Key': this.apiKey(),
      'User-Agent': this.opts.userAgent,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private storedSession(): Session | null {
    const raw = this.opts.session.get();
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Session;
      return typeof s.token === 'string' && API_HOSTS.has(s.baseUrl) && s.expiresAt > this.now() + 60_000 ? s : null;
    } catch {
      return null;
    }
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.opts.timeoutMs ?? 15_000)]);
      for (let redirects = 0; redirects <= 5; redirects++) {
        const target = new URL(url);
        const authenticated = Boolean(init.headers && 'Api-Key' in init.headers);
        if (
          target.protocol !== 'https:' ||
          target.username ||
          target.password ||
          target.port ||
          (authenticated ? !API_HOSTS.has(target.hostname) : !FILE_HOSTS.has(target.hostname))
        ) {
          throw new AppError('SUBS_BAD_FILE', 'untrusted host');
        }
        const res = await (this.opts.fetch ?? fetch)(url, {
          ...init,
          redirect: 'manual',
          signal,
        });
        if (![301, 302, 303, 307, 308].includes(res.status)) return res;
        const location = res.headers.get('location');
        await res.body?.cancel();
        // Never replay a quota-consuming POST through a redirect.
        if (!location || (init.method !== 'GET' && init.method !== 'HEAD')) throw new AppError('SUBS_UNAVAILABLE');
        url = new URL(location, url).href;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('SUBS_UNAVAILABLE');
    }
    throw new AppError('SUBS_UNAVAILABLE', 'redirect limit');
  }

  private async json<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
    const body = await readBodyLimited(res, 2 * 1024 * 1024);
    if (!body) throw new AppError('SUBS_UNAVAILABLE', 'response too large');
    let data: unknown;
    try {
      data = JSON.parse(body.toString('utf8'));
    } catch {
      throw new AppError('SUBS_UNAVAILABLE', 'not json');
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new AppError('SUBS_UNAVAILABLE', 'unexpected response');
    return parsed.data;
  }

  async login(): Promise<Session> {
    if (this.signingIn) return this.signingIn;
    this.signingIn = this.performLogin().finally(() => {
      this.signingIn = null;
    });
    return this.signingIn;
  }

  private async performLogin(): Promise<Session> {
    if (this.authBlocked || this.abort.signal.aborted) throw new AppError('SUBS_AUTH');
    const generation = this.generation;
    const username = this.opts.username()?.trim();
    const password = this.opts.password();
    if (!username || !password) throw new AppError('SUBS_AUTH', 'no account');
    const res = await this.send(`https://${DEFAULT_BASE}/api/v1/login`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ username, password }),
    });
    if (res.status === 401 || res.status === 403) {
      this.authBlocked = true;
      await res.body?.cancel();
      // The API asks not to retry wrong credentials.
      throw new AppError('SUBS_AUTH');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError('SUBS_UNAVAILABLE', `HTTP ${res.status}`);
    }
    const data = await this.json(res, loginSchema);
    if (!API_HOSTS.has(data.base_url || DEFAULT_BASE)) throw new AppError('SUBS_UNAVAILABLE', 'untrusted API host');
    const session: Session = {
      token: data.token,
      baseUrl: data.base_url || DEFAULT_BASE,
      expiresAt: jwtExpiry(data.token, this.now()),
    };
    if (generation !== this.generation) throw new AppError('SUBS_AUTH');
    this.opts.session.set(JSON.stringify(session));
    return session;
  }

  private async session(): Promise<Session> {
    return this.storedSession() ?? this.login();
  }

  /** Authenticated request with one new login on 401. */
  private async authed(path: string, init: RequestInit, retryOnAuth = true): Promise<Response> {
    if (this.abort.signal.aborted) throw new AppError('SUBS_UNAVAILABLE');
    const s = await this.session();
    const res = await this.send(`https://${s.baseUrl}/api/v1${path}`, { ...init, headers: this.headers(s.token) });
    if (res.status === 401 && retryOnAuth) {
      await res.body?.cancel();
      this.opts.session.set(null);
      return this.authed(path, init, false);
    }
    if (res.status === 401) {
      this.authBlocked = true;
      this.opts.session.set(null);
      await res.body?.cancel();
      throw new AppError('SUBS_AUTH');
    }
    return res;
  }

  private async withRetries(fn: () => Promise<Response>): Promise<Response> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(500 * 2 ** attempt);
      try {
        const res = await fn();
        if (res.status === 429) await this.quotaError(res);
        if (res.status >= 500) {
          await res.body?.cancel();
          lastError = new AppError('SUBS_UNAVAILABLE', `HTTP ${res.status}`);
          continue;
        }
        return res;
      } catch (error) {
        if (this.abort.signal.aborted) throw new AppError('SUBS_UNAVAILABLE');
        if (error instanceof AppError && error.code !== 'SUBS_UNAVAILABLE') throw error;
        lastError = error;
      }
    }
    throw lastError instanceof AppError ? lastError : new AppError('SUBS_UNAVAILABLE');
  }

  /** GET /subtitles. Parameters lowercase, sorted alphabetically, IDs without leading zeros. */
  async search(q: SubtitleQuery): Promise<SubtitleCandidate[]> {
    const params: Record<string, string> = {
      languages: [...q.languages]
        .map((l) => l.toLowerCase())
        .sort()
        .join(','),
    };
    if (q.tmdbId) params['tmdb_id'] = String(q.tmdbId);
    if (q.parentTmdbId) params['parent_tmdb_id'] = String(q.parentTmdbId);
    if (q.season !== undefined) params['season_number'] = String(q.season);
    if (q.episode !== undefined) params['episode_number'] = String(q.episode);
    if (q.moviehash) params['moviehash'] = q.moviehash.toLowerCase();
    if (q.query) params['query'] = q.query.toLowerCase();
    const search = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
    const res = await this.withRetries(() => this.authed(`/subtitles?${search}`, { method: 'GET' }));
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError('SUBS_UNAVAILABLE', `HTTP ${res.status}`);
    }
    const data = await this.json(res, searchSchema);
    return data.data.flatMap((d) => {
      const a = d.attributes;
      return a.files.map((file) => ({
        provider: 'opensubtitles' as const,
        id: d.id,
        fileId: file.file_id,
        fileName: file.file_name ?? null,
        language: (a.language ?? '').toLowerCase(),
        release: a.release ?? '',
        hearingImpaired: a.hearing_impaired ?? false,
        foreignPartsOnly: a.foreign_parts_only ?? false,
        moviehashMatch: a.moviehash_match ?? false,
        downloadCount: a.download_count ?? 0,
        ratings: a.ratings ?? 0,
        fromTrusted: a.from_trusted ?? false,
        machineTranslated: a.machine_translated ?? false,
      }));
    });
  }

  /** POST /download — counts against the quota, never repeated automatically. */
  async downloadLink(fileId: number): Promise<DownloadLink> {
    let res: Response;
    try {
      res = await this.authed('/download', { method: 'POST', body: JSON.stringify({ file_id: fileId }) });
    } catch (error) {
      // A timeout after sending may still have used one download: the user decides whether to try again.
      throw error instanceof AppError ? error : new AppError('SUBS_UNAVAILABLE');
    }
    if (res.status === 406 || res.status === 429) {
      await this.quotaError(res);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError('SUBS_UNAVAILABLE', `HTTP ${res.status}`);
    }
    const data = await this.json(res, downloadSchema);
    const reset = data.reset_time_utc ? Date.parse(data.reset_time_utc) : NaN;
    return {
      link: data.link,
      fileName: data.file_name,
      remaining: data.remaining ?? null,
      resetTimeUtc: Number.isFinite(reset) ? reset : null,
    };
  }

  /** Fetches the subtitle file at once (the link is temporary and is not stored). */
  async fetchFile(link: string): Promise<Buffer> {
    const url = new URL(link);
    if (url.protocol !== 'https:') throw new AppError('SUBS_BAD_FILE', 'link is not https');
    const res = await this.send(url.toString(), { method: 'GET', headers: { 'User-Agent': this.opts.userAgent } });
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError('SUBS_UNAVAILABLE', `HTTP ${res.status}`);
    }
    const body = await readBodyLimited(res, MAX_SUBTITLE_BYTES);
    if (!body) throw new AppError('SUBS_BAD_FILE', 'file too large');
    return body;
  }

  /** "Sprawdź połączenie": login + account limits. */
  async test(): Promise<{ allowed: number | null; remaining: number | null; level: string | null }> {
    const res = await this.authed('/infos/user', { method: 'GET' });
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError('SUBS_UNAVAILABLE', `HTTP ${res.status}`);
    }
    const data = await this.json(res, userInfoSchema);
    return {
      allowed: data.data.allowed_downloads ?? null,
      remaining: data.data.remaining_downloads ?? null,
      level: data.data.level ?? null,
    };
  }

  async logout(): Promise<void> {
    const s = this.storedSession();
    this.invalidate();
    if (!s) return;
    await this.send(`https://${s.baseUrl}/api/v1/logout`, { method: 'DELETE', headers: this.headers(s.token) }).then(
      (r) => r.body?.cancel(),
      () => undefined,
    );
  }

  invalidate(): void {
    this.generation++;
    this.authBlocked = false;
    this.opts.session.set(null);
  }

  close(): void {
    this.generation++;
    this.abort.abort();
  }

  private async quotaError(res: Response): Promise<never> {
    const body = await this.json(res, quotaSchema).catch((): z.infer<typeof quotaSchema> => ({}));
    const retry = res.headers.get('retry-after');
    const reset = body.reset_time_utc
      ? Date.parse(body.reset_time_utc)
      : retry
        ? /^\d+$/.test(retry)
          ? this.now() + Number(retry) * 1000
          : Date.parse(retry)
        : NaN;
    throw new AppError('SUBS_QUOTA', 'quota', Number.isFinite(reset) ? { resetAt: reset } : {});
  }
}
