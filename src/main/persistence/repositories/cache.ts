import type { z } from 'zod';
import type { Database } from '../db';

export class CacheRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string, schema: z.ZodType<T>): T | undefined {
    const row = this.db.prepare('SELECT value_json, expires_at FROM cache WHERE key = ?').get(key) as
      { value_json: string; expires_at: number } | undefined;
    if (!row) return undefined;
    if (row.expires_at > this.now()) {
      try {
        const parsed = schema.safeParse(JSON.parse(row.value_json));
        if (parsed.success) return parsed.data;
      } catch {
        /* A corrupt cache entry is a miss, never a broken screen. */
      }
    }
    this.db.prepare('DELETE FROM cache WHERE key = ?').run(key);
    return undefined;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.db.prepare('DELETE FROM cache WHERE expires_at <= ?').run(this.now());
    this.db
      .prepare(
        `INSERT INTO cache (key, value_json, expires_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at`,
      )
      .run(key, JSON.stringify(value), this.now() + ttlMs);
  }
}
