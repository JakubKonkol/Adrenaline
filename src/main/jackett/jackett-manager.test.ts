import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JackettStatus } from '@shared/contracts/sources';
import { FakeJackett } from '../../../tests/helpers/fake-jackett';
import { nullLogger } from '../logger';
import { type Database, openDatabase } from '../persistence/db';
import { clearRegisteredSecrets } from '../redact';
import { Secrets, type SafeStorageLike } from '../secrets';
import { type JackettProcess, JackettManager } from './jackett-manager';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};

class FakeProcess implements JackettProcess {
  private listeners: ((code: number | null) => void)[] = [];
  killed = false;
  onExit(l: (code: number | null) => void) {
    this.listeners.push(l);
  }
  kill() {
    this.killed = true;
    this.exit(1);
  }
  exit(code: number | null) {
    for (const l of this.listeners.splice(0)) l(code);
  }
}

const dirs: string[] = [];
let db: Database;
afterEach(() => {
  db?.close();
  clearRegisteredSecrets();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(extra: Partial<ConstructorParameters<typeof JackettManager>[0]> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'adr-jackett-'));
  dirs.push(dataDir);
  db = openDatabase(':memory:', { log: nullLogger });
  const secrets = new Secrets(db, safeStorage, nullLogger);
  const jackett = new FakeJackett();
  const procs: FakeProcess[] = [];
  const spawned: string[][] = [];
  const manager = new JackettManager({
    exePath: process.execPath, // any existing file
    dataDir,
    secrets,
    log: nullLogger,
    fetch: jackett.fetch,
    freePort: () => Promise.resolve(51234),
    backoffMs: [5, 5, 5],
    spawn: (_exe, args) => {
      spawned.push(args);
      // Jackett reads the API key from the config we wrote.
      jackett.apiKey = (
        JSON.parse(readFileSync(join(dataDir, 'ServerConfig.json'), 'utf8')) as { APIKey: string }
      ).APIKey;
      const p = new FakeProcess();
      procs.push(p);
      return p;
    },
    ...extra,
  });
  const statuses: JackettStatus['state'][] = [];
  manager.on('status', (s) => statuses.push(s.state));
  return { manager, jackett, secrets, dataDir, procs, spawned, statuses };
}

describe('JackettManager (D-56, D-57)', () => {
  it('writes port, loopback and API key to ServerConfig.json and starts without --Port', async () => {
    const { manager, dataDir, spawned, secrets } = setup();
    const conn = await manager.ensureRunning();
    const config = JSON.parse(readFileSync(join(dataDir, 'ServerConfig.json'), 'utf8')) as Record<string, unknown>;
    expect(config).toMatchObject({
      Port: 51234,
      LocalBindAddress: '127.0.0.1',
      AllowExternal: false,
      UpdateDisabled: true,
    });
    expect(config['APIKey']).toMatch(/^[0-9a-f]{32}$/);
    expect(secrets.get('jackett.apiKey')).toBe(config['APIKey']);
    expect(spawned[0]).toEqual(['--NoUpdates', '--NoRestart', '--ListenPrivate', '--DataFolder', dataDir]);
    expect(conn.baseUrl).toBe('http://127.0.0.1:51234');
    expect(manager.status).toEqual({ state: 'running', version: 'v0.24.2856' });
  });

  it('sets a random admin password on first start and reuses it later', async () => {
    const { manager, jackett, secrets } = setup();
    await manager.ensureRunning();
    const pw = secrets.get('jackett.adminPassword');
    expect(pw).toBeTruthy();
    expect(jackett.password).toBe(pw);
    await manager.stop();
    await manager.ensureRunning();
    expect(jackett.password).toBe(pw);
  });

  it('configures indexers through the admin API', async () => {
    const { manager, jackett } = setup();
    const { admin } = await manager.ensureRunning();
    await admin.addIndexer('yts');
    expect([...jackett.configured]).toEqual(['yts']);
    expect((await admin.listIndexers(true)).map((i) => i.id)).toEqual(['yts']);
    jackett.failAdd.add('thepiratebay');
    await expect(admin.addIndexer('thepiratebay')).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: 'Site unreachable',
    });
    await admin.removeIndexer('yts');
    expect(jackett.configured.size).toBe(0);
  });

  it('shares one start between concurrent callers', async () => {
    const { manager, spawned } = setup();
    await Promise.all([manager.ensureRunning(), manager.ensureRunning()]);
    expect(spawned).toHaveLength(1);
  });

  it('restarts after a crash and gives up after 3 crashes', async () => {
    const { manager, procs, statuses } = setup();
    await manager.ensureRunning();
    for (let i = 0; i < 3; i++) {
      procs.at(-1)!.exit(1);
      if (i < 2) {
        await new Promise((r) => setTimeout(r, 30));
        expect(manager.status.state).toBe('running');
      }
    }
    expect(manager.status).toEqual({ state: 'crashed', message: 'JACKETT_UNAVAILABLE' });
    expect(statuses).toContain('restarting');
    await expect(manager.ensureRunning()).rejects.toMatchObject({ code: 'JACKETT_UNAVAILABLE' });
    await manager.restart();
    expect(manager.status.state).toBe('running');
  });

  it('is disabled with ADRENALINE_NO_JACKETT and unavailable without the executable', async () => {
    expect(setup({ disabled: true }).manager.status.state).toBe('disabled');
    const missing = setup({ exePath: join(tmpdir(), 'missing', 'JackettConsole.exe') }).manager;
    expect(missing.status).toEqual({ state: 'unavailable', message: 'JACKETT_UNAVAILABLE' });
    await expect(missing.ensureRunning()).rejects.toMatchObject({ code: 'JACKETT_UNAVAILABLE' });
  });

  it('reports a start that never becomes healthy', async () => {
    const dead: typeof fetch = () => Promise.reject(new TypeError('connect ECONNREFUSED'));
    const { manager, procs } = setup({ fetch: dead, startTimeoutMs: 50 });
    await expect(manager.ensureRunning()).rejects.toMatchObject({ code: 'JACKETT_UNAVAILABLE' });
    expect(procs[0]!.killed).toBe(true);
    expect(manager.status).toEqual({ state: 'stopped', message: 'JACKETT_UNAVAILABLE' });
  });
});
