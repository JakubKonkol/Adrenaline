import { z } from 'zod';
import { MATCH_WARNINGS } from '../domain/match';
import { searchTargetSchema } from '../domain/search-target';

export const parsedReleaseSchema = z.object({
  title: z.string(),
  year: z.number().int().nullable(),
  resolution: z.enum(['480p', '576p', '720p', '1080p', '2160p']).nullable(),
  source: z.enum(['Remux', 'BluRay', 'WEB-DL', 'WEBRip', 'HDTV', 'DVDRip', 'CAM', 'TS']).nullable(),
  codec: z.enum(['x264', 'x265/HEVC', 'AV1']).nullable(),
  hdr: z.enum(['HDR', 'HDR10+', 'DV']).nullable(),
  audio: z.array(z.string()),
  languages: z.array(z.string()),
  edition: z.string().nullable(),
  group: z.string().nullable(),
  season: z.number().int().nullable(),
  episode: z.number().int().nullable(),
  isSeasonPack: z.boolean(),
});

/** A merged release as shown to the renderer. Download links stay in main (they may carry API keys). */
export const releaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().nullable(),
  infoHashV1: z.string().nullable(),
  infoHashV2: z.string().nullable(),
  publishedAt: z.number().nullable(),
  parsed: parsedReleaseSchema,
  match: z.object({ score: z.number().int().min(0).max(100), warnings: z.array(z.enum(MATCH_WARNINGS)) }),
  seeders: z.object({ value: z.number().int(), sourceName: z.string(), observedAt: z.number() }).nullable(),
  peers: z.number().int().nullable(),
  sources: z.array(z.object({ id: z.string(), name: z.string(), seeders: z.number().int().nullable() })),
  downloadable: z.boolean(),
});
export type Release = z.infer<typeof releaseSchema>;

export const sessionSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['pending', 'ok', 'empty', 'error']),
  count: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
});
export type SessionSource = z.infer<typeof sessionSourceSchema>;

export const releaseSessionSchema = z.object({
  id: z.string(),
  target: searchTargetSchema,
  sources: z.array(sessionSourceSchema),
  releases: z.array(releaseSchema),
  done: z.boolean(),
  /** BR08: results / nothing found / every source failed / no source enabled. */
  outcome: z.enum(['results', 'none', 'all_failed', 'no_sources']).nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  fromCache: z.boolean(),
});
export type ReleaseSession = z.infer<typeof releaseSessionSchema>;
