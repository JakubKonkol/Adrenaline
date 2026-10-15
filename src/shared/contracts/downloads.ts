import { z } from 'zod';
import { JOB_STATES, PAUSE_REASONS } from '../domain/job-state';
import { SUBTITLE_STATES } from '../domain/job-status';
import { searchTargetSchema } from '../domain/search-target';
import { languageCodeSchema } from './settings';
import { rankedSubtitleSchema } from './subtitles';

export const jobFileSchema = z.object({
  index: z.number().int().nonnegative(),
  path: z.string(),
  size: z.number().nonnegative(),
  selected: z.boolean(),
  doneBytes: z.number().nonnegative(),
  kind: z.enum(['video', 'subtitle', 'executable', 'archive', 'other']),
});
export type JobFile = z.infer<typeof jobFileSchema>;

export const subtitleTaskSchema = z.object({
  id: z.number().int(),
  fileIndex: z.number().int().nullable(),
  lang: z.string(),
  state: z.enum(SUBTITLE_STATES),
  errorCode: z.string().nullable(),
  quotaResetAt: z.number().nullable(),
  targetPath: z.string().nullable(),
  candidates: z.array(rankedSubtitleSchema).default([]),
});
export type SubtitleTaskDto = z.infer<typeof subtitleTaskSchema>;

export const downloadJobSchema = z.object({
  id: z.string(),
  target: searchTargetSchema,
  releaseName: z.string(),
  sources: z.array(z.string()),
  state: z.enum(JOB_STATES),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  errorCode: z.string().nullable(),
  saveDir: z.string(),
  files: z.array(jobFileSchema),
  /** Default choice when the user must confirm the files (awaiting_file_selection). */
  suggestedFiles: z.array(z.number().int()),
  totalBytes: z.number().nullable(),
  infoHashV1: z.string().nullable(),
  infoHashV2: z.string().nullable(),
  seedRatioLimit: z.number().nullable(),
  seedTimeLimitMin: z.number().int().nullable(),
  subtitleLang: z.string().nullable(),
  subtitleFallbackLang: z.string().nullable(),
  subtitles: z.array(subtitleTaskSchema),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});
export type DownloadJob = z.infer<typeof downloadJobSchema>;

/** Live numbers from the engine (every 500 ms, NFR02); not stored on every update. */
export const jobProgressSchema = z.object({
  jobId: z.string(),
  selectedBytes: z.number().nonnegative(),
  selectedDoneBytes: z.number().nonnegative(),
  files: z.array(z.object({ index: z.number().int(), doneBytes: z.number().nonnegative() })),
  downloadRate: z.number().nonnegative(),
  uploadRate: z.number().nonnegative(),
  peers: z.number().int().nonnegative(),
  seeds: z.number().int().nonnegative(),
  ratio: z.number().nonnegative(),
  seedingSeconds: z.number().nonnegative(),
  etaSeconds: z.number().nonnegative().nullable(),
  /** False while the engine restarts (data shown as not current). */
  live: z.boolean(),
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

export const downloadOptionsSchema = z
  .object({
    saveDir: z.string().min(1).max(400).optional(),
    subtitleLang: languageCodeSchema.nullable(),
    subtitleFallbackLang: languageCodeSchema.nullable(),
    seedRatioLimit: z.number().min(0).max(100).nullable(),
    seedTimeLimitMin: z.number().int().min(0).max(525_600).nullable(),
    /** Use "<folder> (2)" when the job folder exists (BR07). */
    renameOnConflict: z.boolean().optional(),
  })
  .strict();
export type DownloadOptions = z.infer<typeof downloadOptionsSchema>;

export const releaseRefSchema = z.object({ sessionId: z.string().max(100), releaseId: z.string().max(200) }).strict();

export const preflightSchema = z.object({
  folder: z.string(),
  sizeBytes: z.number().nullable(),
  freeBytes: z.number().nullable(),
  requiredBytes: z.number().nullable(),
  enoughSpace: z.boolean().nullable(),
  writable: z.boolean(),
  folderExists: z.boolean(),
  pathTooLong: z.boolean(),
  duplicateJobId: z.string().nullable(),
  /** File list known up front (.torrent); empty for magnets ("listed after start"). */
  hasFileList: z.boolean(),
});
export type Preflight = z.infer<typeof preflightSchema>;
