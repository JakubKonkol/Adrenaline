import { afterEach, describe, expect, it, vi } from 'vitest';
import movies from '../../../../tests/fixtures/tmdb/search-movie.json';
import series from '../../../../tests/fixtures/tmdb/search-tv.json';
import film from '../../../../tests/fixtures/tmdb/movie.json';
import show from '../../../../tests/fixtures/tmdb/tv.json';
import season from '../../../../tests/fixtures/tmdb/season.json';
import unauthorized from '../../../../tests/fixtures/tmdb/unauthorized.json';
import limited from '../../../../tests/fixtures/tmdb/rate-limited.json';
import { TmdbClient } from './tmdb-client';

const requestUrl = (input: Parameters<typeof fetch>[0]) => (input instanceof Request ? input.url : input.toString());
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers });
function setup(responses: Response[], token = 'test-read-access-token', language?: string) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(responses.shift() ?? json({}, 500)));
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
  return {
    client: new TmdbClient({
      token: () => token,
      fetch,
      sleep,
      now: () => Date.UTC(2026, 9, 15),
      ...(language ? { language } : {}),
    }),
    fetch,
    sleep,
  };
}
afterEach(() => vi.useRealTimers());

describe('TMDB contract (synthetic fixtures)', () => {
  it('distinguishes 1968/1990, maps movies and authenticates with Bearer in English', async () => {
    const { client, fetch } = setup([json(movies)]);
    const result = await client.search('Night of the Living Dead', 'movie');
    expect(result.map((item) => item.year)).toEqual([1968, 1990]);
    expect(result[0]?.posterPath).not.toBe(result[1]?.posterPath);
    expect(result[0]).toMatchObject({
      type: 'movie',
      title: 'Night of the Living Dead',
      originalTitle: 'Night of the Living Dead',
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(requestUrl(url)).toContain('language=en-US');
    expect(requestUrl(url)).not.toContain('test-read-access-token');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-read-access-token' });
    expect(init?.redirect).toBe('error');
  });

  it('lists trending titles of the week with their backdrops (TV home, 1.0)', async () => {
    const withBackdrop = { results: [{ ...movies.results[0], backdrop_path: '/wide.jpg' }, movies.results[1]] };
    const { client, fetch } = setup([json(withBackdrop), json(series)]);
    const films = await client.trending('movie');
    expect(films.map((f) => f.backdropPath)).toEqual(['/wide.jpg', null]);
    expect(requestUrl(fetch.mock.calls[0]![0])).toContain('/3/trending/movie/week?');
    expect((await client.trending('tv'))[0]?.type).toBe('tv');
    expect(requestUrl(fetch.mock.calls[1]![0])).toContain('/3/trending/tv/week?');
  });

  it('supports v3 API keys, TV names, empty results and missing optional metadata', async () => {
    const key = 'a'.repeat(32);
    const { client, fetch } = setup(
      [
        json(series),
        json({ results: [] }),
        json({ results: [{ ...movies.results[0], release_date: '', poster_path: null, overview: null }] }),
      ],
      key,
    );
    expect(await client.search('Adrenaline', 'tv')).toMatchObject([{ type: 'tv', year: 2024 }]);
    expect(new URL(requestUrl(fetch.mock.calls[0]![0])).searchParams.get('api_key')).toBe(key);
    expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty('Authorization');
    expect(await client.search('nothing', 'movie')).toEqual([]);
    expect(await client.search('movie', 'movie')).toMatchObject([{ year: null, posterPath: null, overview: '' }]);
  });

  it('maps details and episodes without confusing series, season and episode IDs', async () => {
    const { client } = setup([json(film), json(show), json(season)]);
    expect(await client.details('movie', 10331)).toMatchObject({
      imdbId: 'tt0063350',
      runtime: 96,
      genres: ['Horror'],
      seasons: [],
    });
    expect(await client.details('tv', 900001)).toMatchObject({
      runtime: 25,
      seasons: [{ number: 1, episodeCount: 2 }],
    });
    expect(await client.season(900001, 1)).toMatchObject({
      tmdbId: 900001,
      number: 1,
      episodes: [
        { tmdbId: 900003, number: 1, season: 1 },
        { tmdbId: 900004, number: 2, airDate: null },
      ],
    });
  });

  it('in another catalog language, falls back only for an empty overview while preserving its title', async () => {
    const { client, fetch } = setup(
      [json({ ...film, overview: '' }), json({ id: 10331, overview: 'English synopsis', title: 'English title' })],
      undefined,
      'pl-PL',
    );
    expect(await client.details('movie', 10331)).toMatchObject({
      title: film.title,
      overview: 'English synopsis',
      runtime: 96,
    });
    expect(requestUrl(fetch.mock.calls[0]![0])).toContain('language=pl-PL');
    expect(requestUrl(fetch.mock.calls[1]![0])).toContain('language=en-US');
  });

  it('does not ask again for an English overview in the default English catalog', async () => {
    const { client, fetch } = setup([json({ ...film, overview: '' })]);
    expect(await client.details('movie', 10331)).toMatchObject({ overview: '' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps usable details if only the optional language fallback is unavailable', async () => {
    const { client } = setup([json({ ...film, overview: '' }), json({}, 503)], undefined, 'pl-PL');
    expect(await client.details('movie', 10331)).toMatchObject({ title: film.title, overview: '' });
  });

  it.each([
    [401, 'TMDB_UNAUTHORIZED'],
    [403, 'TMDB_UNAUTHORIZED'],
    [404, 'NOT_FOUND'],
    [503, 'TMDB_UNAVAILABLE'],
  ] as const)('maps HTTP %i', async (status, code) => {
    const { client } = setup([json(unauthorized, status)]);
    await expect(client.search('test', 'movie')).rejects.toMatchObject({ code, message: code });
  });

  it('retries 429 once using Retry-After seconds', async () => {
    const { client, fetch, sleep } = setup([json(limited, 429, { 'Retry-After': '2' }), json(movies)]);
    expect(await client.search('test', 'movie')).toHaveLength(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('supports Retry-After HTTP dates and stops after a second 429', async () => {
    const { client, sleep, fetch } = setup([
      json(limited, 429, { 'Retry-After': 'Thu, 15 Oct 2026 00:00:03 GMT' }),
      json(limited, 429),
    ]);
    await expect(client.search('test', 'movie')).rejects.toMatchObject({ code: 'TMDB_RATE_LIMITED' });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry earlier than a long server delay', async () => {
    const { client, fetch, sleep } = setup([json(limited, 429, { 'Retry-After': '120' })]);
    await expect(client.search('test', 'movie')).rejects.toMatchObject({ code: 'TMDB_RATE_LIMITED' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([new Response('<html>gateway</html>'), json({ results: [{ id: 1 }] }), json({ results: 'invalid' })])(
    'rejects HTML and broken schemas',
    async (response) => {
      const { client } = setup([response]);
      await expect(client.search('test', 'movie')).rejects.toMatchObject({ code: 'TMDB_BAD_RESPONSE' });
    },
  );

  it('limits the streamed body even without a content-length header', async () => {
    const { client } = setup([new Response('x'.repeat(5 * 1024 * 1024 + 1))]);
    await expect(client.search('test', 'movie')).rejects.toMatchObject({ code: 'TMDB_BAD_RESPONSE' });
  });

  it('rejects mismatched IDs and episode season numbers', async () => {
    const { client } = setup([
      json(film),
      json({ ...season, episodes: [{ ...season.episodes[0], season_number: 2 }] }),
    ]);
    await expect(client.details('movie', 999)).rejects.toMatchObject({ code: 'TMDB_BAD_RESPONSE' });
    await expect(client.season(900001, 1)).rejects.toMatchObject({ code: 'TMDB_BAD_RESPONSE' });
  });

  it('does not perform HTTP without a key and sanitizes network errors', async () => {
    const { client, fetch } = setup([], '');
    await expect(client.search('test', 'movie')).rejects.toMatchObject({ code: 'TMDB_NO_KEY' });
    expect(fetch).not.toHaveBeenCalled();
    const broken = new TmdbClient({
      token: () => 'secret',
      fetch: () => Promise.reject(new Error('https://api.themoviedb.org?api_key=secret')),
    });
    await expect(broken.search('test', 'movie')).rejects.toMatchObject({
      code: 'TMDB_UNAVAILABLE',
      message: 'TMDB_UNAVAILABLE',
    });
  });

  it('aborts after 10 seconds and clears the request timer', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const client = new TmdbClient({ token: () => 'secret', fetch });
    const assertion = expect(client.search('test', 'movie')).rejects.toMatchObject({ code: 'TMDB_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tests credentials against configuration', async () => {
    const { client, fetch } = setup([
      json({ images: { secure_base_url: 'https://image.tmdb.org/t/p/', poster_sizes: ['w185', 'w342'] } }),
    ]);
    expect(await client.test()).toBe(true);
    expect(requestUrl(fetch.mock.calls[0]![0])).toContain('/configuration');
  });
});
