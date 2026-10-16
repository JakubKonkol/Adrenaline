/**
 * Download job states and allowed transitions (01-architektura.md, "Stany").
 * queued → fetching_metadata → awaiting_file_selection → downloading ⇄ paused → checking → downloaded → completed;
 * any active state → error (resume returns to the previous stage); any → removed.
 * D-80: a finished download is released from the engine right away (`completed`: no seeding, files stay on disk).
 * `seeding` and `stopped` only exist in profiles from 0.9.0 and earlier; they become `completed` on the next start.
 */
export const JOB_STATES = [
  'queued',
  'fetching_metadata',
  'awaiting_file_selection',
  'downloading',
  'paused',
  'checking',
  'downloaded',
  'seeding',
  'stopped',
  'completed',
  'error',
  'removed',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const PAUSE_REASONS = ['user', 'disk_full', 'disk_missing', 'engine_restart'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

const ALLOWED: Record<JobState, readonly JobState[]> = {
  queued: ['fetching_metadata', 'awaiting_file_selection', 'downloading', 'checking', 'paused', 'error', 'removed'],
  fetching_metadata: ['awaiting_file_selection', 'downloading', 'checking', 'paused', 'queued', 'error', 'removed'],
  awaiting_file_selection: ['downloading', 'checking', 'downloaded', 'seeding', 'paused', 'error', 'removed'],
  downloading: ['paused', 'checking', 'downloaded', 'error', 'removed'],
  paused: [
    'queued',
    'fetching_metadata',
    'awaiting_file_selection',
    'downloading',
    'checking',
    'downloaded',
    'seeding',
    'stopped',
    'completed',
    'error',
    'removed',
  ],
  checking: ['downloading', 'downloaded', 'seeding', 'paused', 'error', 'removed'],
  downloaded: ['completed', 'seeding', 'stopped', 'checking', 'downloading', 'paused', 'error', 'removed'],
  seeding: ['completed', 'stopped', 'paused', 'checking', 'downloading', 'error', 'removed'],
  stopped: ['completed', 'seeding', 'checking', 'downloading', 'paused', 'error', 'removed'],
  completed: ['removed'],
  error: ['queued', 'fetching_metadata', 'awaiting_file_selection', 'downloading', 'checking', 'paused', 'removed'],
  removed: [],
};

/** States that occupy a download slot (D-43: main runs the queue). Seeding does not. */
export const ACTIVE_STATES: readonly JobState[] = ['fetching_metadata', 'downloading', 'checking'];

/** States in which the job's torrent lives in the engine. */
export const ENGINE_STATES: readonly JobState[] = [
  'fetching_metadata',
  'awaiting_file_selection',
  'downloading',
  'paused',
  'checking',
  'downloaded',
  'seeding',
  'stopped',
];

/** Finished downloads (files complete). */
export const COMPLETE_STATES: readonly JobState[] = ['downloaded', 'seeding', 'stopped', 'completed'];

export function canTransition(from: JobState, to: JobState): boolean {
  return from === to || ALLOWED[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobState,
    readonly to: JobState,
  ) {
    super(`invalid job transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
