import { z } from 'zod';
import {
  catalogItemSchema,
  catalogSelectionSchema,
  seasonDetailsSchema,
  titleDetailsSchema,
  type CatalogSelection,
  type MediaType,
} from '@shared/contracts/catalog';
import type { SearchTarget } from '@shared/domain/search-target';
import { AppError } from '@shared/errors';
import type { CacheRepository } from '../persistence/repositories/cache';
import type { MediaRepository } from '../persistence/repositories/media';
import type { TmdbClient } from '../providers/tmdb/tmdb-client';

const SEARCH_TTL = 15 * 60_000;
const DETAILS_TTL = 24 * 60 * 60_000;

export class CatalogService {
  constructor(
    private readonly client: TmdbClient,
    private readonly cache: CacheRepository,
    private readonly media: MediaRepository,
  ) {}

  private async cached<T>(key: string, schema: z.ZodType<T>, ttl: number, fetch: () => Promise<T>): Promise<T> {
    this.client.requireToken();
    const value = this.cache.get(`tmdb:v1:pl-PL:${key}`, schema);
    if (value !== undefined) return value;
    const result = await fetch();
    this.cache.set(`tmdb:v1:pl-PL:${key}`, result, ttl);
    return result;
  }

  async search(query: string, type?: MediaType) {
    const normalized = query.trim().replace(/\s+/g, ' ');
    if (!normalized) return [];
    return this.cached(`search:${type ?? 'all'}:${normalized}`, z.array(catalogItemSchema), SEARCH_TTL, async () => {
      const groups = await Promise.all(
        (type ? [type] : (['movie', 'tv'] as const)).map((t) => this.client.search(normalized, t)),
      );
      return groups.flat().sort((a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title, 'pl'));
    });
  }

  details(type: MediaType, tmdbId: number) {
    return this.cached(`details:${type}:${tmdbId}`, titleDetailsSchema, DETAILS_TTL, () =>
      this.client.details(type, tmdbId),
    );
  }

  season(tmdbId: number, number: number) {
    return this.cached(`season:${tmdbId}:${number}`, seasonDetailsSchema, DETAILS_TTL, () =>
      this.client.season(tmdbId, number),
    );
  }

  async select(input: CatalogSelection): Promise<SearchTarget> {
    if (!catalogSelectionSchema.safeParse(input).success) throw new AppError('BAD_REQUEST');
    const title = await this.details(input.type, input.tmdbId);
    const common = {
      tmdbId: title.tmdbId,
      ...(title.imdbId ? { imdbId: title.imdbId } : {}),
      title: title.title,
      originalTitle: title.originalTitle,
      year: title.year,
    };
    if (input.type === 'movie') {
      this.media.saveSelection(title);
      return { kind: 'movie', ...common };
    }
    const season = await this.season(input.tmdbId, input.season!);
    const episode = season.episodes.find((e) => e.number === input.episode);
    if (!episode) throw new AppError('NOT_FOUND');
    this.media.saveSelection(title, episode);
    return { kind: 'episode', ...common, season: episode.season, episode: episode.number };
  }
}
