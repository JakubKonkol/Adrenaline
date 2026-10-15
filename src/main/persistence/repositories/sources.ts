import type { Database } from '../db';

export interface SourceRow {
  id: string;
  kind: 'jackett_builtin' | 'torznab_custom';
  name: string;
  endpoint: string | null;
  indexerId: string | null;
  enabled: boolean;
  apiKeySecret: string | null;
  health: 'unknown' | 'ok' | 'error';
  healthCode: string | null;
  checkedAt: number | null;
  createdAt: number;
}

interface Raw {
  id: string;
  kind: SourceRow['kind'];
  name: string;
  endpoint: string | null;
  indexer_id: string | null;
  enabled: number;
  api_key_secret: string | null;
  health: SourceRow['health'];
  health_message: string | null;
  checked_at: number | null;
  created_at: number;
}

const map = (r: Raw): SourceRow => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  endpoint: r.endpoint,
  indexerId: r.indexer_id,
  enabled: r.enabled === 1,
  apiKeySecret: r.api_key_secret,
  health: r.health,
  healthCode: r.health_message,
  checkedAt: r.checked_at,
  createdAt: r.created_at,
});

export class SourcesRepository {
  constructor(private readonly db: Database) {}

  all(): SourceRow[] {
    return (this.db.prepare('SELECT * FROM sources ORDER BY created_at, id').all() as unknown as Raw[]).map(map);
  }

  get(id: string): SourceRow | null {
    const r = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as unknown as Raw | undefined;
    return r ? map(r) : null;
  }

  upsert(row: SourceRow): void {
    this.db
      .prepare(
        `INSERT INTO sources (id, kind, name, endpoint, indexer_id, enabled, api_key_secret, health, health_message, checked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, endpoint = excluded.endpoint, enabled = excluded.enabled,
           api_key_secret = excluded.api_key_secret, health = excluded.health, health_message = excluded.health_message,
           checked_at = excluded.checked_at`,
      )
      .run(
        row.id,
        row.kind,
        row.name,
        row.endpoint,
        row.indexerId,
        row.enabled ? 1 : 0,
        row.apiKeySecret,
        row.health,
        row.healthCode,
        row.checkedAt,
        row.createdAt,
      );
  }

  setHealth(id: string, health: SourceRow['health'], code: string | null, at: number): void {
    this.db
      .prepare('UPDATE sources SET health = ?, health_message = ?, checked_at = ? WHERE id = ?')
      .run(health, code, at, id);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  }
}
