import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TmdbClient } from './tmdb-client';

/**
 * Contract check against responses recorded by `node scripts/live/tmdb.mjs` (tests/fixtures/tmdb/live, ignored by
 * git: TMDB data is not redistributed). Skipped when the directory is absent, e.g. in CI.
 */
const LIVE = join(import.meta.dirname, '../../../../tests/fixtures/tmdb/live');
const load = (name: string): unknown => JSON.parse(readFileSync(join(LIVE, `${name}.json`), 'utf8'));

function client(byPath: (path: string) => unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = byPath(url.pathname.replace(/^\/3\//, ''));
    return Promise.resolve(new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 }));
  });
  return new TmdbClient({ token: () => 'live-fixture-token', fetch, sleep: () => Promise.resolve() });
}

describe.skipIf(!existsSync(LIVE))('TMDB contract (recorded live responses)', () => {
  it('parses movie search and keeps the 1968 and 1990 versions apart (FR01)', async () => {
    const results = await client(() => load('search-movie')).search('Night of the Living Dead', 'movie');
    const years = results.map((r) => r.year);
    expect(years).toContain(1968);
    expect(years).toContain(1990);
    expect(results.every((r) => r.type === 'movie' && r.title.length > 0)).toBe(true);
  });

  it('parses movie details with IMDb id', async () => {
    const details = await client(() => load('movie')).details('movie', 10331);
    expect(details).toMatchObject({ type: 'movie', tmdbId: 10331, year: 1968 });
    expect(details.imdbId).toMatch(/^tt\d+$/);
  });

  it('parses series, seasons and episodes (FR02)', async () => {
    const tv = load('tv') as { id: number };
    const season = load('season') as { season_number: number };
    const c = client((path) =>
      path === `tv/${tv.id}` ? tv : path === `tv/${tv.id}/season/${season.season_number}` ? season : null,
    );
    const details = await c.details('tv', tv.id);
    expect(details.type).toBe('tv');
    const parsed = await c.season(tv.id, season.season_number);
    expect(parsed.episodes.length).toBeGreaterThan(0);
    expect(parsed).toMatchObject({ number: season.season_number });
    expect(parsed.episodes[0]).toMatchObject({ number: 1 });
  });
});
