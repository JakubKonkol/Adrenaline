import { subtitleTaskSchema, type SubtitleTaskDto } from '@shared/contracts/downloads';
import type { Database } from '../db';

export class SubtitlesRepository {
  constructor(private readonly db: Database) {}

  list(jobId: string): SubtitleTaskDto[] {
    const rows = this.db
      .prepare(
        `SELECT id, file_index AS fileIndex, lang, state, error_code AS errorCode,
      quota_reset_at AS quotaResetAt, target_path AS targetPath, candidates_json AS candidates FROM subtitle_tasks WHERE job_id = ? ORDER BY id`,
      )
      .all(jobId);
    return rows.map((row) =>
      subtitleTaskSchema.parse({ ...row, candidates: JSON.parse(String(row['candidates'] ?? '[]')) as unknown }),
    );
  }

  ensure(jobId: string, fileIndex: number, lang: string): SubtitleTaskDto {
    const existing = this.list(jobId).find((t) => t.fileIndex === fileIndex);
    if (existing) return existing;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO subtitle_tasks (job_id, file_index, lang, state, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .run(jobId, fileIndex, lang, now, now);
    return this.list(jobId).find((t) => t.fileIndex === fileIndex)!;
  }

  update(id: number, patch: Partial<Omit<SubtitleTaskDto, 'id' | 'fileIndex'>>): void {
    const columns = {
      lang: 'lang',
      state: 'state',
      errorCode: 'error_code',
      quotaResetAt: 'quota_reset_at',
      targetPath: 'target_path',
      candidates: 'candidates_json',
    } as const;
    const entries = Object.entries(patch).filter(([key]) => key in columns);
    if (!entries.length) return;
    this.db
      .prepare(
        `UPDATE subtitle_tasks SET ${entries.map(([key]) => `${columns[key as keyof typeof columns]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      )
      .run(
        ...entries.map(([key, value]) =>
          key === 'candidates' ? JSON.stringify(value) : (value as string | number | null),
        ),
        Date.now(),
        id,
      );
  }
}
