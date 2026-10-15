import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../logger';
import { MIGRATIONS, openDatabase, transaction, userVersion } from './db';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('creates the schema in memory', () => {
    const db = openDatabase(':memory:', { log: nullLogger });
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'cache',
        'download_files',
        'download_jobs',
        'episodes',
        'media_items',
        'secrets',
        'settings',
        'sources',
        'subtitle_tasks',
      ]),
    );
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    db.close();
  });

  it('enforces one active job per info hash', () => {
    const db = openDatabase(':memory:', { log: nullLogger });
    const insert = db.prepare(
      `INSERT INTO download_jobs (id, target_json, release_json, source_kind, info_hash_v1, save_dir, state, created_at, updated_at)
       VALUES (?, '{}', '{}', 'magnet', ?, '/x', ?, 0, 0)`,
    );
    insert.run('a', 'hash1', 'downloading');
    expect(() => insert.run('b', 'hash1', 'queued')).toThrow();
    db.prepare("UPDATE download_jobs SET state = 'removed' WHERE id = 'a'").run();
    expect(() => insert.run('c', 'hash1', 'queued')).not.toThrow();
    db.close();
  });

  it('runs new migrations with a backup of the file and rolls back failures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-db-'));
    dirs.push(dir);
    const path = join(dir, 'adrenaline.db');
    openDatabase(path, { log: nullLogger }).close();
    const extra = [...MIGRATIONS, { version: 2, name: 'extra', sql: 'CREATE TABLE extra (id INTEGER);' }];
    const db = openDatabase(path, { log: nullLogger, migrations: extra });
    expect(userVersion(db)).toBe(2);
    db.close();
    expect(existsSync(`${path}.bak-1`)).toBe(true);

    const broken = [...extra, { version: 3, name: 'broken', sql: 'CREATE TABLE ok3 (id INTEGER); NOT SQL;' }];
    expect(() => openDatabase(path, { log: nullLogger, migrations: broken })).toThrow();
    const again = openDatabase(path, { log: nullLogger, migrations: extra });
    expect(userVersion(again)).toBe(2);
    expect(again.prepare("SELECT name FROM sqlite_master WHERE name = 'ok3'").get()).toBeUndefined();
    again.close();
    expect(readdirSync(dir).filter((f) => f.includes('.bak-')).length).toBeLessThanOrEqual(3);
  });

  it('transaction rolls back on error', () => {
    const db = openDatabase(':memory:', { log: nullLogger });
    expect(() =>
      transaction(db, () => {
        db.prepare("INSERT INTO settings (key, value_json) VALUES ('a', '1')").run();
        throw new Error('fail');
      }),
    ).toThrow('fail');
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
    db.close();
  });
});
