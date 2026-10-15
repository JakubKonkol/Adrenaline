import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Deliberately separate from test/CI; no token or full request URL is ever printed.
if (existsSync('.env')) process.loadEnvFile('.env');
const token = process.env.TMDB_TOKEN?.trim();
if (!token) {
  console.error('Ustaw TMDB_TOKEN w .env. Skrypt live nie został uruchomiony.');
  process.exitCode = 1;
} else {
  const output = resolve('tests/fixtures/tmdb/live');
  const pick = (value, fields) =>
    Object.fromEntries(fields.filter((key) => key in value).map((key) => [key, value[key]]));
  const common = ['id', 'overview', 'poster_path', 'popularity'];
  const movieFields = [...common, 'title', 'original_title', 'release_date'];
  const tvFields = [...common, 'name', 'original_name', 'first_air_date'];
  async function request(path, params = {}, credential = token) {
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    url.search = new URLSearchParams({ language: 'pl-PL', ...params }).toString();
    const headers = { Accept: 'application/json' };
    if (/^[a-f\d]{32}$/i.test(credential)) url.searchParams.set('api_key', credential);
    else headers.Authorization = `Bearer ${credential}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok && response.status !== 401) throw new Error(`TMDB HTTP ${response.status}`);
    return { status: response.status, body: await response.json() };
  }
  async function save(name, value) {
    const json = JSON.stringify(value, null, 2).split(token).join('[REDACTED]');
    await writeFile(resolve(output, `${name}.json`), json + '\n');
    console.log(`Zapisano ${name}.json`);
  }
  try {
    await mkdir(output, { recursive: true });
    const movies = await request('search/movie', { query: 'Night of the Living Dead', include_adult: 'false' });
    if (movies.status === 401) throw new Error('TMDB HTTP 401');
    await save('search-movie', { results: movies.body.results.map((row) => pick(row, movieFields)) });
    const series = await request('search/tv', {
      query: process.env.TMDB_TEST_TV_QUERY || 'The Adventures of Ozzie and Harriet',
      include_adult: 'false',
    });
    await save('search-tv', { results: series.body.results.map((row) => pick(row, tvFields)) });
    const film = await request('movie/10331', { append_to_response: 'external_ids' });
    await save('movie', pick(film.body, [...movieFields, 'runtime', 'genres', 'external_ids']));
    const showId = series.body.results[0]?.id;
    if (!showId) throw new Error('Brak serialu w wynikach');
    const show = await request(`tv/${showId}`, { append_to_response: 'external_ids' });
    await save('tv', pick(show.body, [...tvFields, 'episode_run_time', 'genres', 'external_ids', 'seasons']));
    const number = show.body.seasons.find((s) => s.season_number > 0)?.season_number;
    if (number === undefined) throw new Error('Brak sezonu');
    const season = await request(`tv/${showId}/season/${number}`);
    await save('season', {
      ...pick(season.body, ['id', 'season_number', 'name']),
      episodes: season.body.episodes.map((row) =>
        pick(row, ['id', 'name', 'season_number', 'episode_number', 'air_date', 'overview']),
      ),
    });
    await save('unauthorized', await request('configuration', {}, 'invalid-live-probe'));
    await save('provenance', {
      capturedAt: new Date().toISOString(),
      seriesId: showId,
      season: number,
      rateLimit: 'Not requested; tested offline to avoid flooding TMDB.',
    });
  } catch {
    console.error(
      'Test live TMDB nie powiódł się. Sprawdź klucz i połączenie; częściowe odpowiedzi pozostają w katalogu live.',
    );
    process.exitCode = 1;
  }
}
