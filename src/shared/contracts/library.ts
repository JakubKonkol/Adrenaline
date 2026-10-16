import { z } from 'zod';

/**
 * Library (D-80): finished video files of downloads, projected from the jobs. No local paths leave main — items are
 * addressed by an opaque id (`<jobId>~<fileIndex>`), the same for the desktop and the TV API.
 */
export const libraryItemIdSchema = z
  .string()
  .max(100)
  .regex(/^[\w-]{1,64}~\d{1,6}$/);

export const libraryItemSchema = z.object({
  id: libraryItemIdSchema,
  jobId: z.string(),
  kind: z.enum(['movie', 'episode']),
  tmdbId: z.number().int().positive(),
  title: z.string(),
  year: z.number().int().nullable(),
  season: z.number().int().nullable(),
  episode: z.number().int().nullable(),
  episodeTitle: z.string().nullable(),
  posterPath: z.string().nullable(),
  /** File name only (no folder). */
  fileName: z.string(),
  sizeBytes: z.number().nonnegative(),
  completedAt: z.number().nullable(),
  /** Languages of subtitle files saved next to the video. */
  subtitles: z.array(z.string().max(16)),
  /** False when the file was moved or deleted outside Adrenaline (FILE_MISSING). */
  available: z.boolean(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;

export function libraryItemId(jobId: string, fileIndex: number): string {
  return `${jobId}~${fileIndex}`;
}

export function parseLibraryItemId(id: string): { jobId: string; fileIndex: number } | null {
  if (!libraryItemIdSchema.safeParse(id).success) return null;
  const [jobId, index] = id.split('~') as [string, string];
  return { jobId, fileIndex: Number(index) };
}
