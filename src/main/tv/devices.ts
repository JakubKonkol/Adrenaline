import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { TvDevice, TvPlatform } from '@shared/contracts/tv';
import type { Database } from '../persistence/db';

/** 256-bit random device token (CSPRNG); only its SHA-256 is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time check of a secret against its stored SHA-256 hex. */
export function matchesHash(secret: string, hash: string): boolean {
  const x = Buffer.from(hashToken(secret), 'hex');
  const y = Buffer.from(hash, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

interface Row {
  id: string;
  name: string;
  platform: TvPlatform;
  client_version: string | null;
  created_at: number;
  last_seen_at: number | null;
  last_address: string | null;
}

const toDevice = (r: Row): TvDevice => ({
  id: r.id,
  name: r.name,
  platform: r.platform,
  clientVersion: r.client_version,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  lastAddress: r.last_address,
});

/** Paired TVs (migration 002) and per-device playback positions. */
export class TvDevicesRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  serverId(): string {
    const row = this.db.prepare('SELECT server_id AS id FROM tv_server WHERE id = 1').get() as
      { id: string } | undefined;
    if (row) return row.id;
    const id = randomUUID();
    this.db.prepare('INSERT INTO tv_server (id, server_id) VALUES (1, ?)').run(id);
    return id;
  }

  list(): TvDevice[] {
    return (this.db.prepare('SELECT * FROM tv_devices ORDER BY created_at').all() as unknown as Row[]).map(toDevice);
  }

  /** Creates a device and returns it with its token (shown once, to the TV that claimed the pairing). */
  add(input: { name: string; platform: TvPlatform; clientVersion: string | null; address: string }): {
    device: TvDevice;
    token: string;
  } {
    const token = newToken();
    const id = randomUUID();
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO tv_devices (id, name, platform, token_hash, client_version, created_at, last_seen_at, last_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.platform, hashToken(token), input.clientVersion, now, now, input.address);
    return { device: this.list().find((d) => d.id === id)!, token };
  }

  byToken(token: string): TvDevice | null {
    if (!token || token.length > 200) return null;
    const row = this.db.prepare('SELECT * FROM tv_devices WHERE token_hash = ?').get(hashToken(token)) as
      Row | undefined;
    return row ? toDevice(row) : null;
  }

  exists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM tv_devices WHERE id = ?').get(id) !== undefined;
  }

  seen(id: string, address: string, clientVersion?: string): void {
    this.db
      .prepare(
        'UPDATE tv_devices SET last_seen_at = ?, last_address = ?, client_version = COALESCE(?, client_version) WHERE id = ?',
      )
      .run(this.now(), address, clientVersion ?? null, id);
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM tv_devices WHERE id = ?').run(id).changes > 0;
  }

  progress(deviceId: string): Map<string, { positionMs: number; durationMs: number | null }> {
    const rows = this.db
      .prepare(
        'SELECT item_id AS itemId, position_ms AS positionMs, duration_ms AS durationMs FROM playback_progress WHERE device_id = ?',
      )
      .all(deviceId) as { itemId: string; positionMs: number; durationMs: number | null }[];
    return new Map(rows.map((r) => [r.itemId, { positionMs: r.positionMs, durationMs: r.durationMs }]));
  }

  saveProgress(deviceId: string, itemId: string, positionMs: number, durationMs: number | null): void {
    this.db
      .prepare(
        `INSERT INTO playback_progress (device_id, item_id, position_ms, duration_ms, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (device_id, item_id) DO UPDATE SET position_ms = excluded.position_ms,
         duration_ms = excluded.duration_ms, updated_at = excluded.updated_at`,
      )
      .run(deviceId, itemId, positionMs, durationMs, this.now());
  }
}
