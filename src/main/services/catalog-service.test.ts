import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import movies from '../../../tests/fixtures/tmdb/search-movie.json';
import series from '../../../tests/fixtures/tmdb/search-tv.json';
import film from '../../../tests/fixtures/tmdb/movie.json';
import show from '../../../tests/fixtures/tmdb/tv.json';
import season from '../../../tests/fixtures/tmdb/season.json';
import { nullLogger } from '../logger';
import { openDatabase, type Database } from '../persistence/db';
import { CacheRepository } from '../persistence/repositories/cache';
import { MediaRepository } from '../persistence/repositories/media';
import { TmdbClient } from '../providers/tmdb/tmdb-client';
import { CatalogService } from './catalog-service';

describe('catalog service and SQLite', () => {
  let db: Database;
  let now: number;
  let token: string | null;
  let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  let service: CatalogService;
  beforeEach(() => {
    db = openDatabase(':memory:', { log: nullLogger });
    now = 1000;
    token = 'test-token';
    fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      const data =
        path === '/3/search/movie'
          ? movies
          : path === '/3/search/tv'
            ? series
            : path === '/3/movie/10331'
              ? film
              : path === '/3/tv/900001'
                ? show
                : season;
      return Promise.resolve(Response.json(data));
    });
    service = new CatalogService(
      new TmdbClient({ token: () => token, fetch }),
      new CacheRepository(db, () => now),
      new MediaRepository(db),
    );
  });
  afterEach(() => db.close());

  it('merges movies and series by popularity and caches normalized queries for 15 minutes', async () => {
    expect((await service.search(' Night   of the Living Dead ')).map((i) => i.tmdbId)).toEqual([10331, 900001, 19185]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await service.search('Night of the Living Dead');
    expect(fetch).toHaveBeenCalledTimes(2);
    now += 15 * 60_000;
    await service.search('Night of the Living Dead');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(db.prepare('SELECT COUNT(*) AS n FROM media_items').get()).toEqual({ n: 0 });
  });

  it('filters before requesting and ignores blank searches', async () => {
    expect(await service.search(' ')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await service.search('film', 'movie')).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches details and seasons for 24h and writes media only on selection', async () => {
    await service.details('tv', 900001);
    await service.season(900001, 1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM media_items').get()).toEqual({ n: 0 });
    const target = await service.select({ type: 'tv', tmdbId: 900001, season: 1, episode: 2 });
    expect(target).toEqual({
      kind: 'episode',
      tmdbId: 900001,
      title: show.name,
      originalTitle: show.original_name,
      year: 2024,
      season: 1,
      episode: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await service.select({ type: 'tv', tmdbId: 900001, season: 1, episode: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM media_items').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT season, episode, tmdb_episode_id FROM episodes').all()).toEqual([
      { season: 1, episode: 2, tmdb_episode_id: 900004 },
    ]);
    now += 24 * 60 * 60_000;
    await service.details('tv', 900001);
    await service.season(900001, 1);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps movie identifiers and rejects nonexistent episodes without inserting media', async () => {
    await expect(service.select({ type: 'tv', tmdbId: 900001, season: 1, episode: 99 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM media_items').get()).toEqual({ n: 0 });
    expect(await service.select({ type: 'movie', tmdbId: 10331 })).toMatchObject({
      kind: 'movie',
      tmdbId: 10331,
      imdbId: 'tt0063350',
      year: 1968,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM episodes').get()).toEqual({ n: 0 });
    await expect(service.select({ type: 'tv', tmdbId: 900001 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('treats corrupted cache as a miss and does not put secrets in cache keys or values', async () => {
    await service.search('film', 'movie');
    const row = db.prepare('SELECT key, value_json FROM cache').get() as { key: string; value_json: string };
    expect(JSON.stringify(row)).not.toContain('test-token');
    db.prepare('UPDATE cache SET value_json = ?').run('{broken');
    await service.search('film', 'movie');
    expect(fetch).toHaveBeenCalledTimes(2);
    token = null;
    await expect(service.search('film', 'movie')).rejects.toMatchObject({ code: 'TMDB_NO_KEY' });
  });

  it('does not cache failures and recovers on the next search', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(service.search('film', 'movie')).rejects.toMatchObject({ code: 'TMDB_UNAVAILABLE' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM cache').get()).toEqual({ n: 0 });
    expect(await service.search('film', 'movie')).toHaveLength(2);
  });
});
