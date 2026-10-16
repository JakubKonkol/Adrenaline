import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Release, type ReleaseSession, type SessionSource, sessionSourceSchema } from '@shared/contracts/releases';
import { compareReleases, matchRelease } from '@shared/domain/match';
import { bestSeeders, dedupe, type MergedRelease, type SourceHit } from '@shared/domain/release';
import { parseReleaseName } from '@shared/domain/release-parser';
import type { SearchTarget } from '@shared/domain/search-target';
import { AppError } from '@shared/errors';
import type { Logger } from '../logger';
import type { CacheRepository } from '../persistence/repositories/cache';
import {
  buildQueries,
  type TorznabCaps,
  type TorznabClient,
  type TorznabSource,
} from '../providers/torznab/torznab-client';
import { Emitter } from '../util/emitter';
import type { SourcesService } from './sources-service';

const CAPS_TTL = 24 * 60 * 60 * 1000;
const RESULTS_TTL = 5 * 60 * 1000;
const MAX_RELEASES = 300;

const capsSchema: z.ZodType<TorznabCaps> = z.object({
  search: z.object({ available: z.boolean(), params: z.array(z.string()) }),
  movieSearch: z.object({ available: z.boolean(), params: z.array(z.string()) }),
  tvSearch: z.object({ available: z.boolean(), params: z.array(z.string()) }),
  categories: z.array(z.number()),
});

const hitSchema: z.ZodType<SourceHit> = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
  guid: z.string().nullable(),
  title: z.string(),
  size: z.number().nullable(),
  publishedAt: z.number().nullable(),
  seeders: z.number().nullable(),
  peers: z.number().nullable(),
  infoHash: z.string().nullable(),
  magnet: z.string().nullable(),
  link: z.string().nullable(),
  imdbId: z.string().nullable(),
  observedAt: z.number(),
});
const cachedSessionSchema = z.object({ hits: z.array(hitSchema), sources: z.array(sessionSourceSchema) });

/** Who started a search: the desktop UI or a paired TV (its device id). TVs never evict desktop sessions. */
export type SessionOwner = 'desktop' | `tv:${string}`;

/** Sessions kept per owner, and in total (TV sessions are dropped first). */
const SESSIONS_PER_OWNER = 10;
const SESSIONS_TOTAL = 40;

interface Session {
  id: string;
  owner: SessionOwner;
  target: SearchTarget;
  sources: SessionSource[];
  hits: SourceHit[];
  merged: MergedRelease[];
  done: boolean;
  outcome: ReleaseSession['outcome'];
  startedAt: number;
  finishedAt: number | null;
  fromCache: boolean;
  controller: AbortController;
}

export interface ReleaseSearchOptions {
  sources: SourcesService;
  torznab: TorznabClient;
  cache: CacheRepository;
  log: Logger;
  now?: () => number;
  /** D-55: at most 3 sources queried at once, 20 s per session. */
  concurrency?: number;
  sessionTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Download data for a chosen release (main only: links may contain API keys). */
export interface ReleaseDownloadInfo {
  release: MergedRelease;
  target: SearchTarget;
}

/**
 * Searches all enabled sources in parallel and streams partial results (FR03, NFR03, BR08): after every source the
 * merged, matched and sorted list is emitted. One failing source never removes the others' results.
 */
export class ReleaseSearchService extends Emitter<{ update: ReleaseSession }> {
  private sessions = new Map<string, Session>();

  constructor(private readonly opts: ReleaseSearchOptions) {
    super();
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  start(target: SearchTarget, refresh = false, owner: SessionOwner = 'desktop'): string {
    const session: Session = {
      id: randomUUID(),
      owner,
      target,
      sources: [],
      hits: [],
      merged: [],
      done: false,
      outcome: null,
      startedAt: this.now(),
      finishedAt: null,
      fromCache: false,
      controller: new AbortController(),
    };
    this.sessions.set(session.id, session);
    this.evict(owner);
    void this.run(session, refresh).catch((error: unknown) => {
      this.opts.log.error('release search failed', error);
      this.finish(session);
    });
    return session.id;
  }

  /** Keep memory bounded: the last few sessions per owner are kept for "Download", oldest TV sessions go first. */
  private evict(owner: SessionOwner): void {
    const drop = (s: Session) => {
      s.controller.abort();
      this.sessions.delete(s.id);
    };
    const own = [...this.sessions.values()].filter((s) => s.owner === owner);
    for (const s of own.slice(0, -SESSIONS_PER_OWNER)) drop(s);
    const all = [...this.sessions.values()];
    const excess = all.length - SESSIONS_TOTAL;
    if (excess > 0) for (const s of all.filter((x) => x.owner !== 'desktop').slice(0, excess)) drop(s);
  }

  ownerOf(id: string): SessionOwner | null {
    return this.sessions.get(id)?.owner ?? null;
  }

  cancel(id: string): void {
    const s = this.sessions.get(id);
    if (!s || s.done) return;
    s.controller.abort();
  }

  session(id: string): ReleaseSession | null {
    const s = this.sessions.get(id);
    return s ? this.toDto(s) : null;
  }

  downloadInfo(sessionId: string, releaseId: string): ReleaseDownloadInfo | null {
    const s = this.sessions.get(sessionId);
    const release = s?.merged.find((r) => r.id === releaseId);
    return s && release ? { release, target: s.target } : null;
  }

  private cacheKey(target: SearchTarget, sourceIds: string[]): string {
    const key = JSON.stringify({
      k: target.kind,
      t: target.tmdbId,
      ...(target.kind === 'episode' ? { s: target.season, e: target.episode } : {}),
      src: [...sourceIds].sort(),
    });
    return `releases:${createHash('sha256').update(key).digest('hex')}`;
  }

  private async run(session: Session, refresh: boolean) {
    const { sources, failed } = await this.opts.sources.searchable();
    session.sources = [
      ...sources.map((s): SessionSource => ({ id: s.id, name: s.name, state: 'pending', count: 0, errorCode: null })),
      ...failed.map((f): SessionSource => ({ id: f.id, name: f.name, state: 'error', count: 0, errorCode: f.code })),
    ];
    if (session.sources.length === 0) {
      this.finish(session);
      return;
    }
    const key = this.cacheKey(
      session.target,
      session.sources.map((s) => s.id),
    );
    const cached = refresh ? undefined : this.opts.cache.get(key, cachedSessionSchema);
    if (cached) {
      session.hits = cached.hits;
      session.sources = cached.sources;
      session.fromCache = true;
      this.recompute(session);
      this.finish(session);
      return;
    }
    this.emitUpdate(session);

    const timeout = setTimeout(() => session.controller.abort(), this.opts.sessionTimeoutMs ?? 20_000);
    const queue = [...sources];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) await this.searchSource(session, s);
    };
    // The session ends at its time limit even if a source ignores the abort signal (e.g. a hung Jackett).
    const aborted = new Promise<void>((resolve) =>
      session.controller.signal.addEventListener('abort', () => resolve()),
    );
    try {
      await Promise.race([
        Promise.all(Array.from({ length: Math.min(this.opts.concurrency ?? 3, queue.length) }, worker)),
        aborted,
      ]);
    } finally {
      clearTimeout(timeout);
    }
    for (const s of session.sources) {
      if (s.state === 'pending') Object.assign(s, { state: 'error', errorCode: 'SOURCE_TIMEOUT' });
    }
    if (session.sources.some((s) => s.state === 'ok' || s.state === 'empty')) {
      this.opts.cache.set(key, { hits: session.hits, sources: session.sources }, RESULTS_TTL);
    }
    this.finish(session);
  }

  private async caps(source: TorznabSource, signal: AbortSignal): Promise<TorznabCaps> {
    const key = `torznab:caps:${source.id}`;
    const cached = this.opts.cache.get(key, capsSchema);
    if (cached) return cached;
    const caps = await this.opts.torznab.caps(source, signal);
    this.opts.cache.set(key, caps, CAPS_TTL);
    return caps;
  }

  private async searchSource(session: Session, source: TorznabSource) {
    const state = session.sources.find((s) => s.id === source.id)!;
    const signal = session.controller.signal;
    if (signal.aborted) return;
    try {
      const caps = await this.caps(source, signal);
      const hits: SourceHit[] = [];
      for (const query of buildQueries(session.target, caps)) {
        hits.push(...(await this.searchWithRetry(source, query, signal)));
      }
      if (session.done) return; // answered after the session limit
      session.hits.push(...hits);
      Object.assign(state, { state: hits.length ? 'ok' : 'empty', count: hits.length, errorCode: null });
      this.opts.sources.recordHealth(source.id, null);
    } catch (error) {
      if (session.done) return;
      const code = signal.aborted ? 'SOURCE_TIMEOUT' : error instanceof AppError ? error.code : 'SOURCE_UNAVAILABLE';
      Object.assign(state, { state: 'error', errorCode: code });
      this.opts.sources.recordHealth(source.id, code);
      this.opts.log.warn(`source ${source.name} failed: ${code}`);
    }
    this.recompute(session);
    this.emitUpdate(session);
  }

  /** One retry with jitter for a transient failure (D-55), honoring a short Retry-After. */
  private async searchWithRetry(source: TorznabSource, query: Record<string, string>, signal: AbortSignal) {
    try {
      return await this.opts.torznab.search(source, query, signal);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'SOURCE_UNAVAILABLE' || signal.aborted) throw error;
      const retryAfter = Number(error.details?.['retryAfter']);
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 300 + (this.opts.random ?? Math.random)() * 700;
      if (wait > 3_000) throw error;
      await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
      return this.opts.torznab.search(source, query, signal);
    }
  }

  private recompute(session: Session) {
    session.merged = dedupe(session.hits);
  }

  private finish(session: Session) {
    session.done = true;
    session.finishedAt = this.now();
    const states = session.sources.map((s) => s.state);
    session.outcome =
      states.length === 0
        ? 'no_sources'
        : session.merged.length > 0
          ? 'results'
          : states.every((s) => s === 'error')
            ? 'all_failed'
            : 'none';
    this.emitUpdate(session);
  }

  private emitUpdate(session: Session) {
    this.emit('update', this.toDto(session));
  }

  private toDto(s: Session): ReleaseSession {
    const releases: Release[] = s.merged.map((r) => {
      const parsed = parseReleaseName(r.name);
      const seeders = bestSeeders(r.hits);
      const peers = r.hits.reduce<number | null>((m, h) => (h.peers === null ? m : Math.max(m ?? 0, h.peers)), null);
      const publishedAt = r.hits.reduce<number | null>((m, h) => h.publishedAt ?? m, null);
      return {
        id: r.id,
        name: r.name,
        size: r.size,
        infoHashV1: r.infoHashV1,
        infoHashV2: r.infoHashV2,
        publishedAt,
        parsed,
        match: matchRelease(parsed, s.target),
        seeders,
        peers,
        sources: r.hits.map((h) => ({ id: h.sourceId, name: h.sourceName, seeders: h.seeders })),
        downloadable: r.hits.some((h) => h.magnet !== null || h.link !== null),
      };
    });
    releases.sort((a, b) =>
      compareReleases({ ...a, seeders: a.seeders?.value ?? null }, { ...b, seeders: b.seeders?.value ?? null }),
    );
    return {
      id: s.id,
      target: s.target,
      sources: s.sources.map((x) => ({ ...x })),
      releases: releases.slice(0, MAX_RELEASES),
      done: s.done,
      outcome: s.outcome,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      fromCache: s.fromCache,
    };
  }
}
