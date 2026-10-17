import { z } from 'zod';
import type { CatalogCollection } from '@shared/contracts/catalog';
import type { CatalogItem, MediaType, SeasonDetails, TitleDetails } from '@shared/contracts/catalog';
import { AppError } from '@shared/errors';
import {
  movieDetailsSchema,
  type movieSchema,
  movieSearchSchema,
  seasonSchema,
  tvDetailsSchema,
  type tvSchema,
  tvSearchSchema,
} from './schemas';

interface Options {
  token: () => string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Catalog language (D-77: en-US). Any other language falls back to an English overview when its own is empty. */
  language?: string;
}
export const CATALOG_LANGUAGE = 'en-US';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_RETRY_WAIT_MS = 10_000;

function year(date: string | null): number | null {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(0, 4)) : null;
}
function movie(row: z.infer<typeof movieSchema>): CatalogItem {
  return {
    type: 'movie',
    tmdbId: row.id,
    title: row.title,
    originalTitle: row.original_title,
    year: year(row.release_date),
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path ?? null,
    overview: row.overview ?? '',
    popularity: row.popularity,
  };
}
function tv(row: z.infer<typeof tvSchema>): CatalogItem {
  return {
    type: 'tv',
    tmdbId: row.id,
    title: row.name,
    originalTitle: row.original_name,
    year: year(row.first_air_date),
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path ?? null,
    overview: row.overview ?? '',
    popularity: row.popularity,
  };
}

/** No raw provider error, URL or credential is returned to the renderer or logged. */
export class TmdbClient {
  constructor(private readonly options: Options) {}

  requireToken(): string {
    const token = this.options.token()?.trim();
    if (!token) throw new AppError('TMDB_NO_KEY');
    return token;
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string> = {},
    language = this.options.language ?? CATALOG_LANGUAGE,
  ): Promise<T> {
    const token = this.requireToken();
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    url.search = new URLSearchParams({ language, ...params }).toString();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (/^[a-f\d]{32}$/i.test(token)) url.searchParams.set('api_key', token);
    else headers['Authorization'] = `Bearer ${token}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
      let retryMs: number | undefined;
      try {
        const response = await (this.options.fetch ?? fetch)(url, {
          headers,
          signal: controller.signal,
          redirect: 'error',
        });
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const seconds = retryAfter === null ? 1 : Number(retryAfter);
          const ms = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(retryAfter ?? '') - (this.options.now ?? Date.now)();
          await response.body?.cancel();
          if (attempt > 0 || !Number.isFinite(ms) || ms > MAX_RETRY_WAIT_MS) throw new AppError('TMDB_RATE_LIMITED');
          retryMs = Math.max(0, ms);
        } else {
          if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 401 || response.status === 403) throw new AppError('TMDB_UNAUTHORIZED');
            if (response.status === 404) throw new AppError('NOT_FOUND');
            throw new AppError('TMDB_UNAVAILABLE');
          }
          if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
            await response.body?.cancel();
            throw new AppError('TMDB_BAD_RESPONSE');
          }
          const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
          if (!reader) throw new AppError('TMDB_BAD_RESPONSE');
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new AppError('TMDB_BAD_RESPONSE');
              }
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
          }
          let json: unknown;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw new AppError('TMDB_BAD_RESPONSE');
          }
          const parsed = schema.safeParse(json);
          if (!parsed.success) throw new AppError('TMDB_BAD_RESPONSE');
          return parsed.data;
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('TMDB_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
      if (retryMs !== undefined)
        await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(retryMs);
    }
    throw new AppError('TMDB_RATE_LIMITED');
  }

  async search(query: string, type: MediaType): Promise<CatalogItem[]> {
    const params = { query, include_adult: 'false', page: '1' };
    return type === 'movie'
      ? (await this.request('search/movie', movieSearchSchema, params)).results.map(movie)
      : (await this.request('search/tv', tvSearchSchema, params)).results.map(tv);
  }

  /** Titles trending this week (TV home screen, 1.0). */
  async trending(type: MediaType): Promise<CatalogItem[]> {
    return type === 'movie'
      ? (await this.request('trending/movie/week', movieSearchSchema)).results.map(movie)
      : (await this.request('trending/tv/week', tvSearchSchema)).results.map(tv);
  }

  async collection(type: MediaType, collection: CatalogCollection): Promise<CatalogItem[]> {
    const genres = {
      action: type === 'movie' ? '28' : '10759',
      comedy: '35',
      scifi: type === 'movie' ? '878' : '10765',
    };
    const genre = genres[collection as keyof typeof genres];
    if (
      (collection === 'on_the_air' && type !== 'tv') ||
      (['now_playing', 'upcoming'].includes(collection) && type !== 'movie')
    )
      throw new AppError('BAD_REQUEST');
    const path = genre ? `discover/${type}` : `${type}/${collection}`;
    const params: Record<string, string> = genre
      ? { with_genres: genre, include_adult: 'false', sort_by: 'popularity.desc' }
      : {};
    return type === 'movie'
      ? (await this.request(path, movieSearchSchema, params)).results.map(movie)
      : (await this.request(path, tvSearchSchema, params)).results.map(tv);
  }

  async details(type: MediaType, id: number): Promise<TitleDetails> {
    const params = { append_to_response: 'external_ids' };
    let result: TitleDetails;
    if (type === 'movie') {
      const row = await this.request(`movie/${id}`, movieDetailsSchema, params);
      result = {
        ...movie(row),
        imdbId: row.external_ids.imdb_id,
        genres: row.genres.map((g) => g.name),
        runtime: row.runtime,
        seasons: [],
      };
    } else {
      const row = await this.request(`tv/${id}`, tvDetailsSchema, params);
      result = {
        ...tv(row),
        imdbId: row.external_ids.imdb_id,
        genres: row.genres.map((g) => g.name),
        runtime: row.episode_run_time[0] ?? null,
        seasons: row.seasons.map((s) => ({ number: s.season_number, name: s.name, episodeCount: s.episode_count })),
      };
    }
    if (result.tmdbId !== id) throw new AppError('TMDB_BAD_RESPONSE');
    if (!result.overview.trim() && (this.options.language ?? CATALOG_LANGUAGE) !== 'en-US') {
      try {
        const english = await this.request(
          `${type}/${id}`,
          z.object({ id: z.literal(id), overview: z.string().nullable() }),
          {},
          'en-US',
        );
        result.overview = english.overview ?? '';
      } catch (error) {
        // Missing translation is optional: a network/rate error must not hide otherwise usable details.
        if (!(error instanceof AppError) || !['TMDB_UNAVAILABLE', 'TMDB_RATE_LIMITED'].includes(error.code))
          throw error;
      }
    }
    return result;
  }

  async season(tmdbId: number, number: number): Promise<SeasonDetails> {
    const row = await this.request(`tv/${tmdbId}/season/${number}`, seasonSchema);
    if (row.season_number !== number || row.episodes.some((e) => e.season_number !== number))
      throw new AppError('TMDB_BAD_RESPONSE');
    return {
      tmdbId,
      number,
      name: row.name,
      episodes: row.episodes.map((e) => ({
        tmdbId: e.id,
        number: e.episode_number,
        season: e.season_number,
        title: e.name,
        airDate: e.air_date || null,
        overview: e.overview ?? '',
      })),
    };
  }

  async test(): Promise<boolean> {
    await this.request(
      'configuration',
      z.object({ images: z.object({ secure_base_url: z.string().url(), poster_sizes: z.array(z.string()) }) }),
    );
    return true;
  }
}
