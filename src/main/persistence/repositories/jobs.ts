import { z } from 'zod';
import type { JobState, PauseReason } from '@shared/domain/job-state';
import { type SearchTarget, searchTargetSchema } from '@shared/domain/search-target';
import type { Database } from '../db';

/** Stored release data of a job (names of sources, the magnet/link kept for a retry). */
export const jobReleaseSchema = z.object({
  name: z.string(),
  sources: z.array(z.string()),
  size: z.number().nullable(),
  /** File selection the user must confirm (awaiting_file_selection). */
  suggestedFiles: z.array(z.number().int()).default([]),
});
export type JobRelease = z.infer<typeof jobReleaseSchema>;

export interface JobRow {
  id: string;
  mediaItemId: number | null;
  episodeId: number | null;
  target: SearchTarget;
  release: JobRelease;
  sourceKind: 'magnet' | 'torrent';
  magnet: string | null;
  torrent: Uint8Array | null;
  infoHashV1: string | null;
  infoHashV2: string | null;
  saveDir: string;
  state: JobState;
  pauseReason: PauseReason | null;
  resumeState: JobState | null;
  errorCode: string | null;
  errorMessage: string | null;
  totalBytes: number | null;
  doneBytes: number;
  seedRatioLimit: number | null;
  seedTimeLimitMin: number | null;
  subtitleLang: string | null;
  subtitleFallbackLang: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface FileRow {
  jobId: string;
  index: number;
  relPath: string;
  size: number;
  selected: boolean;
  doneBytes: number;
}

interface RawJob {
  id: string;
  media_item_id: number | null;
  episode_id: number | null;
  target_json: string;
  release_json: string;
  source_kind: 'magnet' | 'torrent';
  magnet: string | null;
  torrent_blob: Uint8Array | null;
  info_hash_v1: string | null;
  info_hash_v2: string | null;
  save_dir: string;
  state: JobState;
  pause_reason: PauseReason | null;
  resume_state: JobState | null;
  error_code: string | null;
  error_message: string | null;
  total_bytes: number | null;
  done_bytes: number;
  seed_ratio_limit: number | null;
  seed_time_limit_min: number | null;
  subtitle_lang: string | null;
  subtitle_fallback_lang: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function mapJob(r: RawJob): JobRow | null {
  const target = searchTargetSchema.safeParse(JSON.parse(r.target_json));
  const release = jobReleaseSchema.safeParse(JSON.parse(r.release_json));
  if (!target.success || !release.success) return null;
  return {
    id: r.id,
    mediaItemId: r.media_item_id,
    episodeId: r.episode_id,
    target: target.data,
    release: release.data,
    sourceKind: r.source_kind,
    magnet: r.magnet,
    torrent: r.torrent_blob,
    infoHashV1: r.info_hash_v1,
    infoHashV2: r.info_hash_v2,
    saveDir: r.save_dir,
    state: r.state,
    pauseReason: r.pause_reason,
    resumeState: r.resume_state,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    totalBytes: r.total_bytes,
    doneBytes: r.done_bytes,
    seedRatioLimit: r.seed_ratio_limit,
    seedTimeLimitMin: r.seed_time_limit_min,
    subtitleLang: r.subtitle_lang,
    subtitleFallbackLang: r.subtitle_fallback_lang,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

/** download_jobs + download_files. SQLite is the only source of truth for the list of jobs (02-protokol). */
export class JobsRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  insert(job: JobRow): void {
    this.db
      .prepare(
        `INSERT INTO download_jobs (id, media_item_id, episode_id, target_json, release_json, source_kind, magnet, torrent_blob,
           info_hash_v1, info_hash_v2, save_dir, state, pause_reason, resume_state, error_code, error_message, total_bytes,
           done_bytes, seed_ratio_limit, seed_time_limit_min, subtitle_lang, subtitle_fallback_lang, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.mediaItemId,
        job.episodeId,
        JSON.stringify(job.target),
        JSON.stringify(job.release),
        job.sourceKind,
        job.magnet,
        job.torrent,
        job.infoHashV1,
        job.infoHashV2,
        job.saveDir,
        job.state,
        job.pauseReason,
        job.resumeState,
        job.errorCode,
        job.errorMessage,
        job.totalBytes,
        job.doneBytes,
        job.seedRatioLimit,
        job.seedTimeLimitMin,
        job.subtitleLang,
        job.subtitleFallbackLang,
        job.createdAt,
        job.updatedAt,
        job.completedAt,
      );
  }

  get(id: string): JobRow | null {
    const r = this.db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(id) as unknown as RawJob | undefined;
    return r ? mapJob(r) : null;
  }

  /** All jobs that are not removed, oldest first (queue order). */
  active(): JobRow[] {
    const rows = this.db
      .prepare("SELECT * FROM download_jobs WHERE state != 'removed' ORDER BY created_at, id")
      .all() as unknown as RawJob[];
    return rows.map(mapJob).filter((j): j is JobRow => j !== null);
  }

  /** Active job with one of the hashes (BR07). */
  findByHash(v1: string | null, v2: string | null): JobRow | null {
    if (!v1 && !v2) return null;
    const r = this.db
      .prepare(
        `SELECT * FROM download_jobs WHERE state != 'removed'
           AND ((info_hash_v1 IS NOT NULL AND info_hash_v1 = ?) OR (info_hash_v2 IS NOT NULL AND info_hash_v2 = ?)) LIMIT 1`,
      )
      .get(v1 ?? '', v2 ?? '') as unknown as RawJob | undefined;
    return r ? mapJob(r) : null;
  }

  update(id: string, patch: Partial<Omit<JobRow, 'id' | 'target' | 'createdAt'>>): void {
    const columns: Record<string, unknown> = {
      release_json: patch.release ? JSON.stringify(patch.release) : undefined,
      magnet: patch.magnet,
      torrent_blob: patch.torrent,
      info_hash_v1: patch.infoHashV1,
      info_hash_v2: patch.infoHashV2,
      save_dir: patch.saveDir,
      state: patch.state,
      pause_reason: patch.pauseReason,
      resume_state: patch.resumeState,
      error_code: patch.errorCode,
      error_message: patch.errorMessage,
      total_bytes: patch.totalBytes,
      done_bytes: patch.doneBytes,
      seed_ratio_limit: patch.seedRatioLimit,
      seed_time_limit_min: patch.seedTimeLimitMin,
      subtitle_lang: patch.subtitleLang,
      subtitle_fallback_lang: patch.subtitleFallbackLang,
      completed_at: patch.completedAt,
    };
    const set = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (set.length === 0) return;
    const sql = `UPDATE download_jobs SET ${set.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    this.db.prepare(sql).run(...(set.map(([, v]) => v) as (string | number | null | Uint8Array)[]), this.now(), id);
  }

  files(jobId: string): FileRow[] {
    return (
      this.db.prepare('SELECT * FROM download_files WHERE job_id = ? ORDER BY file_index').all(jobId) as unknown as {
        job_id: string;
        file_index: number;
        rel_path: string;
        size: number;
        selected: number;
        done_bytes: number;
      }[]
    ).map((r) => ({
      jobId: r.job_id,
      index: r.file_index,
      relPath: r.rel_path,
      size: r.size,
      selected: r.selected === 1,
      doneBytes: r.done_bytes,
    }));
  }

  replaceFiles(jobId: string, files: Omit<FileRow, 'jobId'>[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM download_files WHERE job_id = ?').run(jobId);
      const insert = this.db.prepare(
        'INSERT INTO download_files (job_id, file_index, rel_path, size, selected, done_bytes) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const f of files) insert.run(jobId, f.index, f.relPath, f.size, f.selected ? 1 : 0, f.doneBytes);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  setSelection(jobId: string, indices: number[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE download_files SET selected = 0 WHERE job_id = ?').run(jobId);
      const sel = this.db.prepare('UPDATE download_files SET selected = 1 WHERE job_id = ? AND file_index = ?');
      for (const i of indices) sel.run(jobId, i);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Progress is written every 30 s and on state changes, not on every update. */
  saveProgress(jobId: string, doneBytes: number, files: { index: number; doneBytes: number }[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE download_jobs SET done_bytes = ? WHERE id = ?').run(doneBytes, jobId);
      const f = this.db.prepare('UPDATE download_files SET done_bytes = ? WHERE job_id = ? AND file_index = ?');
      for (const x of files) f.run(x.doneBytes, jobId, x.index);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
