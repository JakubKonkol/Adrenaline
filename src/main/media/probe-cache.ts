import type { MediaProbe } from '@shared/domain/playback';
import type { Database } from '../persistence/db';

/** Bump when parseProbe() learns something new: older rows are probed again. */
export const PROBE_PARSER_VERSION = 1;

/** ffprobe results per library item (migration 003), invalidated by a change of size or mtime. */
export class ProbeCache {
  constructor(private readonly db: Database) {}

  get(itemId: string, sizeBytes: number, mtimeMs: number): MediaProbe | null {
    const row = this.db
      .prepare(
        'SELECT probe_json AS json FROM media_probe WHERE item_id = ? AND size_bytes = ? AND mtime_ms = ? AND parser_version = ?',
      )
      .get(itemId, sizeBytes, Math.round(mtimeMs), PROBE_PARSER_VERSION) as { json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.json) as MediaProbe;
    } catch {
      return null;
    }
  }

  set(itemId: string, sizeBytes: number, mtimeMs: number, probe: MediaProbe): void {
    this.db
      .prepare(
        `INSERT INTO media_probe (item_id, size_bytes, mtime_ms, parser_version, probe_json, probed_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (item_id) DO UPDATE SET size_bytes = excluded.size_bytes,
         mtime_ms = excluded.mtime_ms, parser_version = excluded.parser_version, probe_json = excluded.probe_json,
         probed_at = excluded.probed_at`,
      )
      .run(itemId, sizeBytes, Math.round(mtimeMs), PROBE_PARSER_VERSION, JSON.stringify(probe), Date.now());
  }
}
