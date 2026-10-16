import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../logger';
import init001 from './migrations/001_init.sql?raw';
import tv002 from './migrations/002_tv.sql?raw';
import probe003 from './migrations/003_media_probe.sql?raw';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Ordered migrations; `PRAGMA user_version` holds the last applied version. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: init001 },
  { version: 2, name: 'tv', sql: tv002 },
  { version: 3, name: 'media probe', sql: probe003 },
];

const MAX_BACKUPS = 3;

export type Database = DatabaseSync;

export interface OpenOptions {
  log: Logger;
  migrations?: Migration[];
}

/**
 * Opens (or creates) the SQLite database: WAL, foreign keys, busy timeout, then pending migrations, each in its own
 * transaction. Before migrating an existing file a copy `adrenaline.db.bak-<version>` is kept (max 3).
 */
export function openDatabase(path: string, opts: OpenOptions): Database {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate(db, opts.migrations ?? MIGRATIONS, { log: opts.log, path: path === ':memory:' ? null : path });
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function userVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

export function migrate(db: Database, migrations: Migration[], opts: { log: Logger; path: string | null }): void {
  const current = userVersion(db);
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;
  if (opts.path && current > 0 && existsSync(opts.path)) backup(db, opts.path, current, opts.log);
  for (const m of pending) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
      opts.log.info(`database migrated to ${m.version} (${m.name})`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function backup(db: Database, path: string, version: number, log: Logger): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    copyFileSync(path, `${path}.bak-${version}`);
    const prefix = `${basename(path)}.bak-`;
    const backups = readdirSync(dirname(path))
      .filter((f) => f.startsWith(prefix))
      .map((f) => ({ f, v: Number(f.slice(prefix.length)) }))
      .sort((a, b) => b.v - a.v);
    for (const old of backups.slice(MAX_BACKUPS)) rmSync(join(dirname(path), old.f), { force: true });
  } catch (error) {
    log.warn('database backup failed', error);
  }
}

/** Runs `fn` in a transaction (rolled back on throw). */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
