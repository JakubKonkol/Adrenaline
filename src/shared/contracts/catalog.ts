import { z } from 'zod';
export const catalogCollectionSchema = z.enum([
  'top_rated',
  'now_playing',
  'upcoming',
  'on_the_air',
  'action',
  'comedy',
  'scifi',
]);
export type CatalogCollection = z.infer<typeof catalogCollectionSchema>;

export const mediaTypeSchema = z.enum(['movie', 'tv']);
export const tmdbIdSchema = z.number().int().positive();
export const seasonNumberSchema = z.number().int().min(0).max(10000);
export const catalogItemSchema = z.object({
  type: mediaTypeSchema,
  tmdbId: tmdbIdSchema,
  title: z.string(),
  originalTitle: z.string(),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  /** Wide image for the TV home screen (1.0); missing in catalog entries cached by 0.9.0. */
  backdropPath: z.string().nullable().optional(),
  overview: z.string(),
  popularity: z.number(),
});
export const titleDetailsSchema = catalogItemSchema.extend({
  imdbId: z.string().nullable(),
  genres: z.array(z.string()),
  runtime: z.number().int().nonnegative().nullable(),
  seasons: z.array(
    z.object({ number: seasonNumberSchema, name: z.string(), episodeCount: z.number().int().nonnegative() }),
  ),
});
export const episodeSchema = z.object({
  tmdbId: tmdbIdSchema,
  number: z.number().int().positive(),
  season: seasonNumberSchema,
  title: z.string(),
  airDate: z.iso.date().nullable(),
  overview: z.string(),
});
export const seasonDetailsSchema = z.object({
  tmdbId: tmdbIdSchema,
  number: seasonNumberSchema,
  name: z.string(),
  episodes: z.array(episodeSchema),
});
export const catalogSelectionSchema = z
  .object({
    type: mediaTypeSchema,
    tmdbId: tmdbIdSchema,
    season: seasonNumberSchema.optional(),
    episode: z.number().int().positive().optional(),
  })
  .strict()
  .refine((v) =>
    v.type === 'movie'
      ? v.season === undefined && v.episode === undefined
      : v.season !== undefined && v.episode !== undefined,
  );

export type MediaType = z.infer<typeof mediaTypeSchema>;
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type TitleDetails = z.infer<typeof titleDetailsSchema>;
export type SeasonDetails = z.infer<typeof seasonDetailsSchema>;
export type Episode = z.infer<typeof episodeSchema>;
export type CatalogSelection = z.infer<typeof catalogSelectionSchema>;
