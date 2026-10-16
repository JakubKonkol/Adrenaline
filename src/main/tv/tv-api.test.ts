import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import movieFixture from '../../../tests/fixtures/tmdb/movie.json';
import searchFixture from '../../../tests/fixtures/tmdb/search-movie.json';
import { FakeJackett } from '../../../tests/helpers/fake-jackett';
import type { PairingCreated, PairingStatus, TvDownload, TvLibraryItem, TvPlayback } from '@shared/contracts/tv';
import type { ReleaseSession } from '@shared/contracts/releases';
import { EngineSupervisor } from '../engine/engine-process';
import { FakeEngine } from '../engine/fake-engine';
import { nullLogger } from '../logger';
import { type Database, openDatabase } from '../persistence/db';
import { CacheRepository } from '../persistence/repositories/cache';
import { JobsRepository } from '../persistence/repositories/jobs';
import { MediaRepository } from '../persistence/repositories/media';
import { SubtitlesRepository } from '../persistence/repositories/subtitles';
import { TmdbClient } from '../providers/tmdb/tmdb-client';
import { TorznabClient, type TorznabSource } from '../providers/torznab/torznab-client';
import { CatalogService } from '../services/catalog-service';
import { DownloadService } from '../services/download-service';
import { LibraryService } from '../services/library-service';
import { ReleaseSearchService } from '../services/release-search-service';
import { SettingsService } from '../services/settings-service';
import type { SourcesService } from '../services/sources-service';
import { TvDevicesRepository } from './devices';
import { TvService } from './tv-service';

const MiB = 1024 * 1024;
const HASH = 'ab'.repeat(20);
const NAME = 'Night.of.the.Living.Dead.1968.1080p.BluRay';
const rss = `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item><title>${NAME}</title>
<guid>1</guid><size>${8 * MiB}</size><torznab:attr name="seeders" value="9" />
<torznab:attr name="infohash" value="${HASH}" />
<torznab:attr name="magneturl" value="magnet:?xt=urn:btih:${HASH}&amp;dn=${NAME}" /></item></channel></rss>`;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function setup() {
  const base = mkdtempSync(join(tmpdir(), 'adr-tv-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const db: Database = openDatabase(':memory:', { log: nullLogger });
  cleanups.push(() => db.close());
  const port = 20000 + Math.floor(Math.random() * 30000);
  const settings = new SettingsService(db, { downloadDir: join(base, 'Videos'), randomPort: () => 50000 });

  const tmdbFetch: typeof fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = url.pathname.includes('/trending/') ? searchFixture : movieFixture;
    return Promise.resolve(new Response(JSON.stringify(body)));
  };
  const tmdb = new TmdbClient({ token: () => 'token', fetch: tmdbFetch });
  const media = new MediaRepository(db);
  const catalog = new CatalogService(tmdb, new CacheRepository(db), media);

  const torznabFetch: typeof fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return Promise.resolve(new Response(url.searchParams.get('t') === 'caps' ? FakeJackett.fixture('caps.xml') : rss));
  };
  const source: TorznabSource = { id: 'a', name: 'A', endpoint: 'http://a/api', apiKey: () => 'k' };
  const sources = {
    searchable: () => Promise.resolve({ sources: [source], failed: [] }),
    recordHealth: () => undefined,
  } as unknown as SourcesService;
  const releases = new ReleaseSearchService({
    sources,
    torznab: new TorznabClient({ fetch: torznabFetch }),
    cache: new CacheRepository(db),
    log: nullLogger,
  });

  const fake = new FakeEngine({
    tickMs: 10,
    metadataDelayMs: 5,
    rate: 64 * MiB,
    files: (name) => [{ path: `${name}/${name}.mp4`, size: 2 * MiB, pad: false }],
  });
  const engine = new EngineSupervisor({ launch: fake.launch, log: nullLogger, clientVersion: 't', heartbeatMs: 1e9 });
  cleanups.push(() => engine.stop());
  const jobs = new JobsRepository(db);
  const subtitles = new SubtitlesRepository(db);
  const downloads = new DownloadService({
    jobs,
    engine,
    settings,
    releaseInfo: (s, r) => releases.downloadInfo(s, r),
    endpointFor: () => Promise.resolve(null),
    log: nullLogger,
  });
  await engine.start();
  const library = new LibraryService({
    jobs,
    subtitles,
    media,
    removeJob: (id, deleteFiles) => downloads.remove(id, deleteFiles),
  });
  const devices = new TvDevicesRepository(db);
  const tv = new TvService({
    version: '1.0.0-test',
    devices,
    catalog,
    releases,
    downloads: () => downloads,
    library,
    media,
    settings,
    subtitleAccountReady: () => false,
    log: nullLogger,
    addresses: () => [{ address: '127.0.0.1', interfaceName: 'lo', private: true }],
  });
  cleanups.push(() => tv.stop());
  settings.update({ tvServerEnabled: true, tvServerPort: port });
  await tv.apply();
  expect(tv.status()).toMatchObject({ state: 'running', url: `http://127.0.0.1:${port}` });

  const url = `http://127.0.0.1:${port}`;
  const call = async <T>(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
  };
  const pair = async (name: string) => {
    const created = await call<PairingCreated>('POST', '/api/v1/pairings', {
      body: { deviceName: name, platform: 'tizen', clientVersion: '1.0.0' },
    });
    expect(created.status).toBe(200);
    const pending = tv.status().pending.find((p) => p.deviceName === name)!;
    expect(pending.code).toBe(created.body.code);
    tv.approve(pending.id);
    const claimed = await call<PairingStatus>('POST', `/api/v1/pairings/${created.body.pairingId}/claim`, {
      body: { claimSecret: created.body.claimSecret },
    });
    if (claimed.body.status !== 'approved') throw new Error('not approved');
    return claimed.body.token;
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> => {
    for (let i = 0; i < 400; i++) {
      const v = await fn();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout');
  };
  return { tv, call, pair, until, url, downloads, settings };
}

/** `fetch` always sends the real Host; DNS rebinding sends another name. */
function rawStatus(base: string, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('TV API v1 on loopback (B7)', () => {
  it('runs pairing → catalog → releases → download → library → stream, and revoke cuts access', async () => {
    const { tv, call, pair, until, url, downloads } = await setup();

    expect((await call<{ apiVersion: number }>('GET', '/api/v1/info')).body.apiVersion).toBe(1);
    expect((await call('GET', '/api/v1/library')).status).toBe(401);
    expect((await call('GET', '/api/v1/library', { token: 'x'.repeat(43) })).status).toBe(401);
    expect(await rawStatus(url, '/api/v1/info', 'attacker.example')).toBe(403);
    expect(await rawStatus(url, '/api/v1/info', new URL(url).host)).toBe(200);

    const token = await pair('Living room');
    expect(tv.status().devices.map((d) => d.name)).toEqual(['Living room']);

    const trending = await call<{ title: string }[]>('GET', '/api/v1/catalog/trending?type=movie', { token });
    expect(trending.status).toBe(200);
    expect(trending.body.length).toBeGreaterThan(0);

    const search = await call<{ sessionId: string }>('POST', '/api/v1/release-searches', {
      token,
      body: { type: 'movie', tmdbId: 10331 },
    });
    expect(search.status).toBe(200);
    const session = await until(
      () => call<ReleaseSession>('GET', `/api/v1/release-searches/${search.body.sessionId}`, { token }),
      (r) => r.body.done,
    );
    expect(session.body.releases[0]?.name).toBe(NAME);

    // Another TV cannot read or use this TV's search.
    const other = await pair('Bedroom');
    expect((await call('GET', `/api/v1/release-searches/${search.body.sessionId}`, { token: other })).status).toBe(404);
    expect(
      (
        await call('POST', '/api/v1/downloads', {
          token: other,
          body: { sessionId: search.body.sessionId, releaseId: session.body.releases[0]!.id, subtitles: false },
        })
      ).status,
    ).toBe(404);

    const created = await call<TvDownload>('POST', '/api/v1/downloads', {
      token,
      body: { sessionId: search.body.sessionId, releaseId: session.body.releases[0]!.id, subtitles: true },
    });
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.body)).not.toMatch(/saveDir|magnet|infoHash|Videos/);
    await until(
      () => call<TvDownload[]>('GET', '/api/v1/downloads', { token }),
      (r) => r.body[0]?.state === 'completed',
    );

    // The fake engine does not write files: put the finished film where the job expects it.
    const job = downloads.get(created.body.id);
    const film = join(job.saveDir, job.files[0]!.path);
    mkdirSync(join(film, '..'), { recursive: true });
    writeFileSync(film, Buffer.from('0123456789'));
    writeFileSync(film.replace(/\.mp4$/, '.en.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHello\n');

    const library = await call<TvLibraryItem[]>('GET', '/api/v1/library', { token });
    expect(library.body).toHaveLength(1);
    expect(library.body[0]).toMatchObject({ title: 'Night of the Living Dead', available: true, resumeMs: null });
    expect(JSON.stringify(library.body)).not.toContain('Videos');

    const playback = await call<TvPlayback>('POST', `/api/v1/playback/${library.body[0]!.id}`, { token });
    expect(playback.body.mimeType).toBe('video/mp4');
    expect(playback.body.streamUrl.startsWith(`${url}/media/`)).toBe(true);

    const part = await fetch(playback.body.streamUrl, { headers: { Range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    const head = await fetch(playback.body.streamUrl, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('10');
    expect((await fetch(playback.body.streamUrl, { headers: { Range: 'bytes=50-' } })).status).toBe(416);

    // Sidecar subtitles exist on disk but were not fetched by Adrenaline: not offered.
    expect(playback.body.subtitles).toEqual([]);

    await call('PUT', `/api/v1/playback/${library.body[0]!.id}/progress`, {
      token,
      body: { positionMs: 60_000, durationMs: 600_000 },
    });
    const resumed = await call<TvLibraryItem[]>('GET', '/api/v1/library', { token });
    expect(resumed.body[0]?.resumeMs).toBe(60_000);

    // A TV never deletes files: removing the job keeps the film on disk.
    const deviceId = tv.status().devices.find((d) => d.name === 'Living room')!.id;
    tv.revoke(deviceId);
    expect((await call('GET', '/api/v1/library', { token })).status).toBe(401);
    expect((await fetch(playback.body.streamUrl)).status).toBe(401);
    expect((await call('GET', '/api/v1/library', { token: other })).status).toBe(200);
  });

  it('rejects bad input and oversized bodies without leaking details', async () => {
    const { call, pair } = await setup();
    const token = await pair('TV');
    const bad = await call<{ error: { code: string; requestId: string } }>('POST', '/api/v1/release-searches', {
      token,
      body: { type: 'movie', tmdbId: -1 },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
    expect(bad.body.error.requestId).toMatch(/^[0-9a-f]{12}$/);
    const huge = await call('POST', '/api/v1/pairings', {
      body: { deviceName: 'x'.repeat(70 * 1024), platform: 'web' },
    });
    expect(huge.status).toBe(400);
    expect((await call('GET', '/api/v1/nothing', { token })).status).toBe(404);
    expect((await call('POST', '/api/v1/pairings', { body: { deviceName: '<script>', platform: 'web' } })).status).toBe(
      400,
    );
  });

  it('stops listening when turned off', async () => {
    const { settings, tv, url } = await setup();
    settings.update({ tvServerEnabled: false });
    await tv.apply();
    expect(tv.status().state).toBe('stopped');
    await expect(fetch(`${url}/api/v1/info`)).rejects.toThrow();
  });
});
