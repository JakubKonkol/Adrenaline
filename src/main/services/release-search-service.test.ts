import { afterEach, describe, expect, it } from 'vitest';
import type { ReleaseSession } from '@shared/contracts/releases';
import type { SearchTarget } from '@shared/domain/search-target';
import { FakeJackett } from '../../../tests/helpers/fake-jackett';
import { nullLogger } from '../logger';
import { type Database, openDatabase } from '../persistence/db';
import { CacheRepository } from '../persistence/repositories/cache';
import { TorznabClient, type TorznabSource } from '../providers/torznab/torznab-client';
import { ReleaseSearchService } from './release-search-service';
import type { SearchableSources, SourcesService } from './sources-service';

const target: SearchTarget = {
  kind: 'movie',
  tmdbId: 10331,
  imdbId: 'tt0063350',
  title: 'Noc żywych trupów',
  originalTitle: 'Night of the Living Dead',
  year: 1968,
};

const item = (title: string, hash: string, seeders: number) =>
  `<item><title>${title}</title><guid>${hash}</guid><size>1000</size>
   <link>http://src/dl/${hash}</link>
   <torznab:attr name="seeders" value="${seeders}" /><torznab:attr name="infohash" value="${hash}" /></item>`;
const rss = (...items: string[]) =>
  `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${items.join('')}</channel></rss>`;
const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);

type Responder = (params: URLSearchParams) => string | Response | Promise<Response>;

let db: Database;
afterEach(() => db?.close());

function setup(
  responders: Record<string, Responder>,
  extra: { failed?: SearchableSources['failed']; timeoutMs?: number } = {},
) {
  db = openDatabase(':memory:', { log: nullLogger });
  const calls: string[] = [];
  const health: [string, string | null][] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const id = url.hostname;
    calls.push(`${id}:${url.searchParams.get('t')}`);
    if (url.searchParams.get('t') === 'caps') return new Response(FakeJackett.fixture('caps.xml'));
    const r = responders[id]!;
    const out = await r(url.searchParams);
    if (out instanceof Response) return out;
    await new Promise((res) => setTimeout(res, 1));
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response(out);
  };
  const sources: TorznabSource[] = Object.keys(responders).map((id) => ({
    id,
    name: id.toUpperCase(),
    endpoint: `http://${id}/api`,
    apiKey: () => 'k',
  }));
  const stub = {
    searchable: () => Promise.resolve({ sources, failed: extra.failed ?? [] }),
    recordHealth: (id: string, code: string | null) => void health.push([id, code]),
  } as unknown as SourcesService;
  const service = new ReleaseSearchService({
    sources: stub,
    torznab: new TorznabClient({ fetch }),
    cache: new CacheRepository(db),
    log: nullLogger,
    sleep: () => Promise.resolve(),
    ...(extra.timeoutMs ? { sessionTimeoutMs: extra.timeoutMs } : {}),
  });
  const updates: ReleaseSession[] = [];
  service.on('update', (u) => updates.push(u));
  const run = async (refresh = false) => {
    const id = service.start(target, refresh);
    for (let i = 0; i < 400 && !updates.some((u) => u.id === id && u.done); i++)
      await new Promise((r) => setTimeout(r, 5));
    return updates.filter((u) => u.id === id);
  };
  return { service, run, calls, health };
}

describe('ReleaseSearchService (FR03, FR04, BR08)', () => {
  it('streams partial results, merges sources and keeps results when one source fails', async () => {
    const { run, health, service } = setup({
      a: () => rss(item('Night.of.the.Living.Dead.1968.1080p.BluRay.x264-A', H1, 10)),
      b: () =>
        rss(
          item('Night of the Living Dead 1968 1080p BluRay', H1, 40),
          item('Night.of.the.Living.Dead.1990.720p', H2, 5),
        ),
      c: () => '<!DOCTYPE html><html>down</html>',
    });
    const updates = await run();
    const last = updates.at(-1)!;
    expect(updates.length).toBeGreaterThanOrEqual(4); // start + one per source + final
    expect(last.outcome).toBe('results');
    expect(last.sources.map((s) => [s.id, s.state, s.errorCode])).toEqual([
      ['a', 'ok', null],
      ['b', 'ok', null],
      ['c', 'error', 'SOURCE_BAD_RESPONSE'],
    ]);
    expect(last.releases).toHaveLength(2);
    const top = last.releases[0]!;
    expect(top.sources.map((s) => s.id)).toEqual(['a', 'b', 'a', 'b'].slice(0, top.sources.length));
    expect(top.seeders).toMatchObject({ value: 40, sourceName: 'B' });
    expect(top.match.warnings).toEqual([]);
    expect(last.releases[1]!.match.warnings).toContain('year_mismatch');
    expect(health).toContainEqual(['c', 'SOURCE_BAD_RESPONSE']);
    // Links never reach the renderer, but are kept for the download.
    expect(JSON.stringify(last)).not.toContain('http://src/dl');
    expect(service.downloadInfo(last.id, top.id)?.release.hits[0]?.link).toBe(`http://src/dl/${H1}`);
  });

  it('tells "nothing found" from "all sources failed" and "no sources"', async () => {
    expect((await setup({ a: () => rss() }).run()).at(-1)!.outcome).toBe('none');
    expect((await setup({ a: () => new Response(null, { status: 503 }) }).run()).at(-1)!.outcome).toBe('all_failed');
    expect((await setup({}).run()).at(-1)!.outcome).toBe('no_sources');
  });

  it('shows sources that could not start (Jackett down) as errors', async () => {
    const updates = await setup(
      { a: () => rss() },
      { failed: [{ id: 'jackett:yts', name: 'YTS', code: 'JACKETT_UNAVAILABLE' }] },
    ).run();
    expect(updates.at(-1)!.sources.find((s) => s.id === 'jackett:yts')).toMatchObject({
      state: 'error',
      errorCode: 'JACKETT_UNAVAILABLE',
    });
  });

  it('stops slow sources at the session limit and keeps the others', async () => {
    const { run } = setup(
      {
        fast: () => rss(item('Night.of.the.Living.Dead.1968.720p', H1, 3)),
        slow: () => new Promise<Response>(() => undefined),
      },
      { timeoutMs: 80 },
    );
    const last = (await run()).at(-1)!;
    expect(last.sources.find((s) => s.id === 'slow')).toMatchObject({ state: 'error', errorCode: 'SOURCE_TIMEOUT' });
    expect(last.releases).toHaveLength(1);
  });

  it('retries a transient failure once', async () => {
    let n = 0;
    const { run } = setup({
      a: () =>
        n++ === 0 ? new Response(null, { status: 503 }) : rss(item('Night.of.the.Living.Dead.1968.720p', H1, 3)),
    });
    expect((await run()).at(-1)!.sources[0]).toMatchObject({ state: 'ok', errorCode: null });
    expect(n).toBe(3); // 503, retry, then the second (Polish title) query
  });

  it('caches results for 5 minutes; refresh bypasses the cache', async () => {
    const { run, calls } = setup({ a: () => rss(item('Night.of.the.Living.Dead.1968.720p', H1, 3)) });
    await run();
    const searches = () => calls.filter((c) => !c.endsWith(':caps')).length;
    const first = searches();
    const cached = (await run()).at(-1)!;
    expect(cached.fromCache).toBe(true);
    expect(searches()).toBe(first);
    await run(true);
    expect(searches()).toBeGreaterThan(first);
  });
});
