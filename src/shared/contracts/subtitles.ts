import { z } from 'zod';

export const subtitleCandidateSchema = z.object({
  id: z.string(),
  fileId: z.number().int().positive(),
  fileName: z.string().nullable(),
  language: z.string(),
  release: z.string(),
  hearingImpaired: z.boolean(),
  foreignPartsOnly: z.boolean(),
  moviehashMatch: z.boolean(),
  downloadCount: z.number(),
  ratings: z.number(),
  fromTrusted: z.boolean(),
  machineTranslated: z.boolean(),
});
export type SubtitleCandidate = z.infer<typeof subtitleCandidateSchema>;
export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export const rankedSubtitleSchema = subtitleCandidateSchema.extend({ confidence: confidenceSchema, score: z.number() });
export type RankedSubtitle = z.infer<typeof rankedSubtitleSchema>;
export const subtitleAccountSchema = z.object({
  allowed: z.number().nullable(),
  remaining: z.number().nullable(),
  level: z.string().nullable(),
});
