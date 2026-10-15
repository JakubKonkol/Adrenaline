import { z } from 'zod';
import { seasonNumberSchema, tmdbIdSchema } from '../contracts/catalog';

const title = {
  tmdbId: tmdbIdSchema,
  imdbId: z.string().optional(),
  title: z.string(),
  originalTitle: z.string(),
  year: z.number().int().nullable(),
};
export const searchTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('movie'), ...title }),
  z.object({ kind: z.literal('episode'), ...title, season: seasonNumberSchema, episode: z.number().int().positive() }),
]);
export type SearchTarget = z.infer<typeof searchTargetSchema>;
