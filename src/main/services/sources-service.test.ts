import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeJackett } from '../../../tests/helpers/fake-jackett';
import { JackettManager } from '../jackett/jackett-manager';
import { nullLogger } from '../logger';
import { type Database, openDatabase } from '../persistence/db';
import { SourcesRepository } from '../persistence/repositories/sources';
import { TorznabClient } from '../providers/torznab/torznab-client';
import { clearRegisteredSecrets } from '../redact';
import { Secrets } from '../secrets';
import { SourcesService } from './sources-service';

let db: Database;
const dirs: string[] = [];
afterEach(() => {
  db?.close();
  clearRegisteredSecrets();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  db = openDatabase(':memory:', { log: nullLogger });
  const dataDir = mkdtempSync(join(tmpdir(), 'adr-src-'));
  dirs.push(dataDir);
  const secrets = new Secrets(
    db,
    { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
    nullLogger,
  );
  const jackett = new FakeJackett();
  const state = { broken: false };
  // A user endpoint (Prowlarr-like) answering on another host.
  const custom: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === 'prowlarr.local') {
      if (url.searchParams.get('apikey') !== 'user-key')
        return Promise.resolve(new Response(FakeJackett.fixture('error-apikey.xml')));
      return Promise.resolve(
        new Response(FakeJackett.fixture(url.searchParams.get('t') === 'caps' ? 'caps.xml' : 'empty.xml')),
      );
    }
    if (state.broken) return Promise.reject(new TypeError('connect ECONNREFUSED'));
    return jackett.fetch(input, init);
  };
  const manager = new JackettManager({
    exePath: process.execPath,
    dataDir,
    secrets,
    log: nullLogger,
    fetch: custom,
    freePort: () => Promise.resolve(50000),
    startTimeoutMs: 50,
    spawn: () => {
      jackett.apiKey = secrets.get('jackett.apiKey') ?? '';
      const exits: ((code: number | null) => void)[] = [];
      return { onExit: (l) => void exits.push(l), kill: () => exits.splice(0).forEach((l) => l(0)) };
    },
  });
  const service = new SourcesService({
    repo: new SourcesRepository(db),
    jackett: manager,
    secrets,
    torznab: new TorznabClient({ fetch: custom }),
    log: nullLogger,
    now: () => 1000,
  });
  return { service, jackett, manager, secrets, state };
}

describe('SourcesService (FR18, D-53)', () => {
  it('lists the default indexers, all disabled on first start', () => {
    const { service } = setup();
    expect(service.list().map((s) => [s.id, s.enabled, s.health])).toEqual([
      ['jackett:yts', false, 'unknown'],
      ['jackett:thepiratebay', false, 'unknown'],
      ['jackett:torrentdownloads', false, 'unknown'],
      ['jackett:limetorrents', false, 'unknown'],
    ]);
  });

  it('enables a built-in indexer through Jackett and disables it again', async () => {
    const { service, jackett } = setup();
    const list = await service.setEnabled('jackett:yts', true);
    expect(list.find((s) => s.id === 'jackett:yts')).toMatchObject({ enabled: true, health: 'ok' });
    expect([...jackett.configured]).toEqual(['yts']);
    await service.setEnabled('jackett:yts', false);
    expect(jackett.configured.size).toBe(0);
    expect(service.list()[0]!.enabled).toBe(false);
  });

  it('keeps an indexer off with the reason when Jackett cannot add it', async () => {
    const { service, jackett } = setup();
    jackett.failAdd.add('thepiratebay');
    await expect(service.setEnabled('jackett:thepiratebay', true)).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });
    expect(service.list().find((s) => s.id === 'jackett:thepiratebay')).toMatchObject({
      enabled: false,
      health: 'error',
      healthCode: 'SOURCE_UNAVAILABLE',
    });
  });

  it('gives searchable Torznab endpoints and re-adds indexers lost by Jackett', async () => {
    const { service, jackett } = setup();
    await service.setEnabled('jackett:yts', true);
    jackett.configured.clear(); // e.g. Jackett data folder reset
    service.resetSync();
    const { sources, failed } = await service.searchable();
    expect(failed).toEqual([]);
    expect(sources.map((s) => s.endpoint)).toEqual([
      'http://127.0.0.1:50000/api/v2.0/indexers/yts/results/torznab/api',
    ]);
    expect(sources[0]!.apiKey()).toBe(jackett.apiKey);
    expect([...jackett.configured]).toEqual(['yts']);
  });

  it('adds a custom Torznab endpoint after a caps check, stores its key as a secret', async () => {
    const { service, secrets } = setup();
    await expect(
      service.addCustom({ name: 'Prowlarr', endpoint: 'http://prowlarr.local/api', apiKey: 'wrong' }),
    ).rejects.toMatchObject({ code: 'SOURCE_AUTH' });
    const list = await service.addCustom({
      name: 'Prowlarr',
      endpoint: 'http://prowlarr.local/api',
      apiKey: 'user-key',
    });
    const custom = list.find((s) => s.kind === 'torznab_custom')!;
    expect(custom).toMatchObject({
      name: 'Prowlarr',
      enabled: true,
      health: 'ok',
      hasApiKey: true,
      endpoint: 'http://prowlarr.local/api',
    });
    expect(secrets.get(`source.${custom.id}.apiKey`)).toBe('user-key');
    expect((await service.test(custom.id)).health).toBe('ok');
    service.remove(custom.id);
    expect(secrets.get(`source.${custom.id}.apiKey`)).toBeNull();
    expect(service.list().some((s) => s.kind === 'torznab_custom')).toBe(false);
  });

  it('rejects non-http endpoints', async () => {
    const { service } = setup();
    await expect(service.addCustom({ name: 'x', endpoint: 'file:///C:/x', apiKey: null })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('reports enabled built-in sources as failed when Jackett is unavailable', async () => {
    const { service, manager, state } = setup();
    await service.setEnabled('jackett:yts', true);
    await manager.stop();
    state.broken = true; // the next start never becomes healthy
    const { sources, failed } = await service.searchable();
    expect(sources).toEqual([]);
    expect(failed).toEqual([{ id: 'jackett:yts', name: 'YTS', code: 'JACKETT_UNAVAILABLE' }]);
  });
});
