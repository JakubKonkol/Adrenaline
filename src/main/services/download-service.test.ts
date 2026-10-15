import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DownloadJob } from '@shared/contracts/downloads';
import type { MergedRelease } from '@shared/domain/release';
import type { SearchTarget } from '@shared/domain/search-target';
import { EngineSupervisor } from '../engine/engine-process';
import { FakeEngine, type FakeEngineOptions } from '../engine/fake-engine';
import { nullLogger } from '../logger';
import { type Database, openDatabase } from '../persistence/db';
import { JobsRepository } from '../persistence/repositories/jobs';
import { DownloadService } from './download-service';
import { SettingsService } from './settings-service';

const MiB = 1024 * 1024;
const target: SearchTarget = { kind: 'movie', tmdbId: 1, title: 'Film', originalTitle: 'Film', year: 2020 };
const hash = (n: number) => n.toString(16).padStart(40, '0');

function release(n: number, over: Partial<MergedRelease> = {}): MergedRelease {
  const name = `Film.2020.1080p.Release${n}`;
  return {
    id: `v1:${hash(n)}`,
    name,
    size: 10 * MiB,
    infoHashV1: hash(n),
    infoHashV2: null,
    magnet: `magnet:?xt=urn:btih:${hash(n)}&dn=${name}`,
    hits: [
      {
        sourceId: 'jackett:yts',
        sourceName: 'YTS',
        guid: String(n),
        title: name,
        size: 10 * MiB,
        publishedAt: null,
        seeders: 5,
        peers: 6,
        infoHash: hash(n),
        magnet: `magnet:?xt=urn:btih:${hash(n)}&dn=${name}`,
        link: null,
        imdbId: null,
        observedAt: 1,
      },
    ],
    ...over,
  };
}

const dirs: string[] = [];
const dbs: Database[] = [];
const sups: EngineSupervisor[] = [];
afterEach(async () => {
  for (const s of sups.splice(0)) await s.stop();
  for (const d of dbs.splice(0)) d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(engineOpts: FakeEngineOptions = {}, shared?: { db: Database; base: string; fake: FakeEngine }) {
  const base = shared?.base ?? mkdtempSync(join(tmpdir(), 'adr-dl-'));
  if (!shared) dirs.push(base);
  const db = shared?.db ?? openDatabase(':memory:', { log: nullLogger });
  if (!shared) dbs.push(db);
  const fake =
    shared?.fake ??
    new FakeEngine({
      tickMs: 10,
      metadataDelayMs: 5,
      rate: 64 * MiB,
      files: (name) => [
        { path: `${name}/${name}.mkv`, size: 8 * MiB, pad: false },
        { path: `${name}/Sample/sample.mkv`, size: MiB, pad: false },
        { path: `${name}/setup.exe`, size: MiB, pad: false },
      ],
      ...engineOpts,
    });
  const settings = new SettingsService(db, { downloadDir: join(base, 'Adrenaline'), randomPort: () => 50000 });
  const engine = new EngineSupervisor({ launch: fake.launch, log: nullLogger, clientVersion: 't', heartbeatMs: 1e9 });
  sups.push(engine);
  const releases = new Map<string, MergedRelease>();
  const svc = new DownloadService({
    jobs: new JobsRepository(db),
    engine,
    settings,
    releaseInfo: (_s, id) => {
      const r = releases.get(id);
      return r ? { release: r, target } : null;
    },
    endpointFor: () => Promise.resolve('http://127.0.0.1:9117/api'),
    log: nullLogger,
  });
  const changes: DownloadJob[] = [];
  svc.on('changed', (j) => changes.push(j));
  await engine.start();
  await until(() => engine.status.state === 'running');
  const add = (r: MergedRelease) => {
    releases.set(r.id, r);
    return svc.create(
      { sessionId: 's', releaseId: r.id },
      { subtitleLang: 'pl', subtitleFallbackLang: null, seedRatioLimit: 1, seedTimeLimitMin: 60 },
    );
  };
  return { svc, engine, fake, db, base, settings, add, changes };
}

async function until(cond: () => boolean, ms = 4000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('DownloadService (etap 6)', () => {
  it('runs a job from magnet to seeding with the default file choice (FR09, FR10)', async () => {
    const { svc, add } = await setup();
    const job = await add(release(1));
    expect(job.saveDir).toMatch(/Film \(2020\)[\\/]Film\.2020\.1080p\.Release1$/);
    await until(() => svc.get(job.id).state === 'seeding');
    const done = svc.get(job.id);
    expect(done.files.filter((f) => f.selected).map((f) => f.path)).toEqual([
      'Film.2020.1080p.Release1/Film.2020.1080p.Release1.mkv',
    ]);
    expect(done.files.find((f) => f.kind === 'executable')?.selected).toBe(false);
    expect(done.completedAt).not.toBeNull();
  });

  it('keeps at most maxActiveDownloads jobs active, the rest queued', async () => {
    const { svc, add, settings } = await setup({ rate: 1 });
    settings.update({ maxActiveDownloads: 2 });
    const jobs = [await add(release(1)), await add(release(2)), await add(release(3))];
    await until(() => jobs.slice(0, 2).every((j) => svc.get(j.id).state === 'downloading'));
    expect(svc.get(jobs[2]!.id).state).toBe('queued');
    await svc.remove(jobs[0]!.id, false);
    await until(() => svc.get(jobs[2]!.id).state === 'downloading');
  });

  it('refuses a duplicate of an active job (BR07)', async () => {
    const { add } = await setup({ rate: 1 });
    const first = await add(release(1));
    await expect(add({ ...release(1), id: 'other-id' })).rejects.toMatchObject({
      code: 'DUPLICATE_JOB',
      message: first.id,
    });
  });

  it('refuses an existing folder unless renaming is chosen (BR07)', async () => {
    const { svc, base, settings } = await setup({ rate: 1 });
    const folder = join(settings.get().downloadDir, 'Film (2020)', 'Film.2020.1080p.Release1');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'mine.txt'), 'x');
    const r = release(1);
    const svcAny = svc as unknown as { deps: { releaseInfo: unknown } };
    svcAny.deps.releaseInfo = () => ({ release: r, target });
    const ref = { sessionId: 's', releaseId: r.id };
    const opts = { subtitleLang: null, subtitleFallbackLang: null, seedRatioLimit: null, seedTimeLimitMin: null };
    expect((await svc.preflight(ref)).folderExists).toBe(true);
    await expect(svc.create(ref, opts)).rejects.toMatchObject({ code: 'PATH_CONFLICT' });
    const job = await svc.create(ref, { ...opts, renameOnConflict: true });
    expect(job.saveDir.endsWith('Release1 (2)')).toBe(true);
    expect(base).toBeTruthy();
  });

  it('pauses only after the engine confirmed and keeps progress (FR11)', async () => {
    const { svc, add, fake } = await setup({ rate: 2 * MiB });
    const job = await add(release(1));
    await until(() => (fake.storedJob(job.id)?.done[0] ?? 0) > 0);
    const paused = await svc.pause(job.id);
    expect(paused).toMatchObject({ state: 'paused', pauseReason: 'user' });
    const done = fake.storedJob(job.id)!.done[0]!;
    await new Promise((r) => setTimeout(r, 60));
    expect(fake.storedJob(job.id)!.done[0]).toBe(done);
    expect((await svc.resume(job.id)).state).toBe('downloading');
  });

  it('removes a job without touching the files by default (FR13)', async () => {
    const { svc, add } = await setup({ rate: 1 });
    const job = await add(release(1));
    await until(() => svc.get(job.id).state === 'downloading');
    await svc.remove(job.id, false);
    expect(() => svc.get(job.id)).toThrow();
    expect(svc.list()).toEqual([]);
  });

  it('pauses on a full disk with the reason (NFR05)', async () => {
    const { svc, add, fake } = await setup({ rate: 1 });
    const job = await add(release(1));
    await until(() => svc.get(job.id).state === 'downloading');
    fake.diskFull(job.id);
    await until(() => svc.get(job.id).state === 'paused');
    expect(svc.get(job.id)).toMatchObject({ pauseReason: 'disk_full', errorCode: 'DISK_FULL' });
  });

  it('asks for the files when the choice is ambiguous', async () => {
    const { svc, add } = await setup({
      rate: 64 * MiB,
      files: (name) => [
        { path: `${name}/Part1.mkv`, size: 4 * MiB, pad: false },
        { path: `${name}/Part2.mkv`, size: 4 * MiB, pad: false },
      ],
    });
    const job = await add(release(1));
    await until(() => svc.get(job.id).state === 'awaiting_file_selection');
    expect(svc.get(job.id).suggestedFiles).toEqual([0]);
    await svc.selectFiles(job.id, [0, 1]);
    await until(() => svc.get(job.id).state === 'seeding');
    expect(svc.get(job.id).files.every((f) => f.selected)).toBe(true);
  });

  it('restores jobs after an app restart with the same state and selection (FR12)', async () => {
    const first = await setup({ rate: 2 * MiB });
    const running = await first.add(release(1));
    const paused = await first.add(release(2));
    await until(() => first.svc.get(paused.id).state === 'downloading');
    await first.svc.pause(paused.id);
    await until(() => (first.fake.storedJob(running.id)?.done[0] ?? 0) > 0);
    first.svc.persistAll();
    await first.engine.stop();

    const second = await setup({}, { db: first.db, base: first.base, fake: first.fake });
    await until(
      () => second.svc.get(running.id).state === 'downloading' || second.svc.get(running.id).state === 'seeding',
    );
    expect(second.svc.get(paused.id)).toMatchObject({ state: 'paused', pauseReason: 'user' });
    expect(second.svc.get(running.id).files.filter((f) => f.selected)).toHaveLength(1);
    expect(first.fake.launches).toBe(2);
  });

  it('re-adds jobs after an engine crash (NFR04)', async () => {
    const { svc, add, fake, engine } = await setup({ rate: 1 });
    const job = await add(release(1));
    await until(() => svc.get(job.id).state === 'downloading');
    fake.crash();
    await until(() => fake.launches === 2 && engine.status.state === 'running');
    await until(() => fake.running?.instance !== undefined && fake.storedJob(job.id) !== undefined);
    expect(svc.get(job.id).state).toBe('downloading');
    expect(svc.list()).toHaveLength(1);
  });
});

describe('DownloadService restart without resume data', () => {
  it('sends the stored selection again when the magnet metadata arrives', async () => {
    const first = await setup({ rate: 2 * MiB });
    const job = await first.add(release(1));
    await until(() => first.svc.get(job.id).state === 'downloading');
    await first.svc.pause(job.id);
    await first.engine.stop();
    // A new engine with no resume data at all (fresh FakeEngine store).
    const second = await setup(
      { rate: 2 * MiB },
      { db: first.db, base: first.base, fake: new FakeEngine({ tickMs: 10, metadataDelayMs: 5, rate: 2 * MiB }) },
    );
    await until(() => second.svc.get(job.id).state === 'paused');
    const resumed = await second.svc.resume(job.id);
    expect(resumed.state).not.toBe('error');
    await until(() => second.svc.get(job.id).state === 'downloading');
    expect(second.svc.get(job.id).files.filter((f) => f.selected)).toHaveLength(1);
  });
});

describe('DownloadService event order', () => {
  it('the last emitted job state carries the chosen files', async () => {
    const { svc, add, changes } = await setup({ rate: 1 });
    const job = await add(release(7));
    await until(() => svc.get(job.id).state === 'downloading');
    await new Promise((r) => setTimeout(r, 50));
    const last = changes.filter((c) => c.id === job.id).at(-1)!;
    expect(last.files.filter((f) => f.selected)).toHaveLength(1);
  });
});
