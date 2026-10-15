import type { JobState, PauseReason } from './job-state';

export const SUBTITLE_STATES = [
  'disabled',
  'pending',
  'searching',
  'needs_selection',
  'downloading',
  'ready',
  'not_found',
  'quota_exceeded',
  'error',
] as const;
export type SubtitleState = (typeof SUBTITLE_STATES)[number];

export type JobStatusKind =
  | 'queued'
  | 'fetching_metadata'
  | 'awaiting_selection'
  | 'downloading'
  | 'checking'
  | 'paused'
  | 'paused_disk_full'
  | 'paused_disk_missing'
  | 'engine_restarting'
  | 'error'
  | 'subtitles_in_progress'
  | 'ready_subtitles_attention'
  | 'ready'
  | 'removed';

export interface DerivedJobStatus {
  kind: JobStatusKind;
  /** BR02: every selected file verified and every subtitle ready or disabled. */
  ready: boolean;
  /** Seeding is shown next to the status, not instead of it. */
  seeding: boolean;
  /** The film itself is complete (it can be watched). */
  filesComplete: boolean;
}

export interface JobStatusInput {
  state: JobState;
  pauseReason: PauseReason | null;
}

export interface FileInput {
  selected: boolean;
  size: number;
  doneBytes: number;
}

const ATTENTION: readonly SubtitleState[] = ['not_found', 'quota_exceeded', 'error', 'needs_selection'];

/** Status shown in the UI (BR02, BR03): readiness requires the files and the subtitles. */
export function deriveJobStatus(
  job: JobStatusInput,
  files: FileInput[],
  subtitles: { state: SubtitleState }[],
): DerivedJobStatus {
  const selected = files.filter((f) => f.selected);
  const filesComplete =
    // A paused complete job (e.g. seeding paused by the user) still has its film ready.
    ['downloaded', 'seeding', 'stopped', 'paused'].includes(job.state) &&
    selected.length > 0 &&
    selected.every((f) => f.doneBytes >= f.size);
  const seeding = job.state === 'seeding';
  const base = { seeding, filesComplete };

  if (job.state === 'removed') return { kind: 'removed', ready: false, ...base };
  if (job.state === 'error') return { kind: 'error', ready: false, ...base };
  if (job.state === 'paused' && !filesComplete) {
    const kind =
      job.pauseReason === 'disk_full'
        ? 'paused_disk_full'
        : job.pauseReason === 'disk_missing'
          ? 'paused_disk_missing'
          : job.pauseReason === 'engine_restart'
            ? 'engine_restarting'
            : 'paused';
    return { kind, ready: false, ...base };
  }
  if (!filesComplete) {
    const map: Partial<Record<JobState, JobStatusKind>> = {
      queued: 'queued',
      fetching_metadata: 'fetching_metadata',
      awaiting_file_selection: 'awaiting_selection',
      downloading: 'downloading',
      checking: 'checking',
    };
    return { kind: map[job.state] ?? 'downloading', ready: false, ...base };
  }
  const subs = subtitles.filter((s) => s.state !== 'disabled');
  if (subs.every((s) => s.state === 'ready')) return { kind: 'ready', ready: true, ...base };
  if (subs.some((s) => ATTENTION.includes(s.state)))
    return { kind: 'ready_subtitles_attention', ready: false, ...base };
  return { kind: 'subtitles_in_progress', ready: false, ...base };
}
