import { z } from 'zod';

const id = z.number().int().positive();
const date = z.union([z.iso.date(), z.literal('')]).nullable();
const common = {
  id,
  overview: z.string().nullable(),
  poster_path: z.string().nullable(),
  backdrop_path: z.string().nullable().optional(),
  popularity: z.number(),
};
export const movieSchema = z.object({
  ...common,
  title: z.string(),
  original_title: z.string(),
  release_date: date,
});
export const tvSchema = z.object({
  ...common,
  name: z.string(),
  original_name: z.string(),
  first_air_date: date,
});
export const movieSearchSchema = z.object({ results: z.array(movieSchema) });
export const tvSearchSchema = z.object({ results: z.array(tvSchema) });
const details = {
  genres: z.array(z.object({ id, name: z.string() })),
  external_ids: z.object({ imdb_id: z.string().nullable() }),
};
export const movieDetailsSchema = movieSchema.extend({
  ...details,
  runtime: z.number().int().nonnegative().nullable(),
});
export const tvDetailsSchema = tvSchema.extend({
  ...details,
  episode_run_time: z.array(z.number().int().nonnegative()),
  seasons: z.array(
    z.object({
      season_number: z.number().int().nonnegative(),
      name: z.string(),
      episode_count: z.number().int().nonnegative(),
    }),
  ),
});
export const seasonSchema = z.object({
  id,
  season_number: z.number().int().nonnegative(),
  name: z.string(),
  episodes: z.array(
    z.object({
      id,
      episode_number: z.number().int().positive(),
      season_number: z.number().int().nonnegative(),
      name: z.string(),
      air_date: date,
      overview: z.string().nullable(),
    }),
  ),
});
