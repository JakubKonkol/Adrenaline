import type { DownloadJob, JobProgress } from '@shared/contracts/downloads';
import { type DerivedJobStatus, deriveJobStatus } from '@shared/domain/job-status';

/** Job + live progress → derived status (BR02) and selected byte totals. */
export function jobView(job: DownloadJob, progress: JobProgress | undefined) {
  const files = job.files.map((f) => ({
    ...f,
    doneBytes: progress?.files.find((p) => p.index === f.index)?.doneBytes ?? f.doneBytes,
  }));
  const status: DerivedJobStatus = deriveJobStatus(job, files, job.subtitles);
  const selected = files.filter((f) => f.selected);
  const total = progress?.selectedBytes || selected.reduce((a, f) => a + f.size, 0);
  const done = progress?.selectedDoneBytes ?? selected.reduce((a, f) => a + f.doneBytes, 0);
  const percent = total > 0 ? (done / total) * 100 : null;
  return { status, files, total, done, percent };
}

export function episodeLabel(job: DownloadJob): string | null {
  const t = job.target;
  return t.kind === 'episode' ? `S${String(t.season).padStart(2, '0')}E${String(t.episode).padStart(2, '0')}` : null;
}

export const isFinished = (job: DownloadJob) => ['downloaded', 'seeding', 'stopped'].includes(job.state);
