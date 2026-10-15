/**
 * Local swarm test of adrenaline-engine (03-testy.md): a seeder and a leecher on 127.0.0.1 without DHT/UPnP, own
 * generated data only. Run with `ADRENALINE_ENGINE_PATH=<binary> npm run test:engine`.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
  closeSync,
  ftruncateSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineEvent, EngineMetadata, JobStatus } from '@shared/contracts/engine';
import { EngineClient } from '../../../src/main/engine/engine-client';
import { type EngineInstance, spawnEngine } from '../../../src/main/engine/engine-process';
import { nullLogger } from '../../../src/main/logger';

const ENGINE = process.env['ADRENALINE_ENGINE_PATH'];
const SKIP_BIG = process.env['ADRENALINE_SKIP_BIG'] === '1';
/** Directory to record raw protocol lines into (used to refresh tests/fixtures/engine-protocol). */
const RECORD = process.env['ADRENALINE_RECORD_PROTOCOL'];
let recordCount = 0;
const MiB = 1024 * 1024;
const POLISH = 'Zażółć gęślą jaźń.bin';

interface TorrentInfo {
  name: string;
  infoHashV1: string;
  infoHashV2: string;
  magnet: string;
  totalSize: number;
  numFiles: number;
}

class Engine {
  readonly events: EngineEvent[] = [];
  readonly client: EngineClient;
  private readonly instance: EngineInstance;
  listenPort = 0;

  constructor(dataDir: string, extra: string[] = []) {
    this.instance = spawnEngine({
      binaryPath: ENGINE!,
      args: ['--data-dir', dataDir, '--listen-port', '0', '--no-dht', '--no-upnp', '--test-mode', ...extra],
      log: nullLogger,
    });
    this.client = new EngineClient({ transport: this.instance.transport, log: nullLogger, timeoutMs: 15_000 });
    if (RECORD) {
      const file = join(RECORD, `engine-${++recordCount}.jsonl`);
      const write = this.instance.transport.write.bind(this.instance.transport);
      this.instance.transport.write = (line) => {
        appendFileSync(
          file,
          `> ${line}
`,
        );
        write(line);
      };
      this.instance.transport.onLine((line) =>
        appendFileSync(
          file,
          `< ${line}
`,
        ),
      );
    }
    this.client.on('event', (e) => this.events.push(e));
  }

  async hello() {
    // libtorrent may briefly reopen its listen sockets (network change on Windows): ask until a port is known.
    for (let i = 0; ; i++) {
      const h = await this.client.hello('test');
      this.listenPort = h.listenPort ?? 0;
      if (this.listenPort > 0 || i >= 40) return h;
      await sleep(250);
    }
  }

  kill() {
    this.instance.kill();
  }

  async shutdown() {
    if (this.client.isClosed) return;
    const closed = new Promise<void>((r) => this.client.once('closed', () => r()));
    await this.client.request('shutdown', {}).catch(() => undefined);
    await closed;
  }

  async status(jobId: string): Promise<JobStatus> {
    const snap = await this.client.request('snapshot', {});
    const s = snap.jobs.find((j) => j.jobId === jobId);
    if (!s) throw new Error(`no job ${jobId}`);
    return s;
  }

  metadata(jobId: string): EngineMetadata | undefined {
    for (const e of this.events) if (e.event === 'metadata' && e.data.jobId === jobId) return e.data;
    return undefined;
  }

  states(jobId: string): string[] {
    return this.events.flatMap((e) => (e.event === 'state' && e.data.jobId === jobId ? [e.data.state] : []));
  }
}

async function until<T>(
  fn: () => Promise<T | undefined | false> | T | undefined | false,
  ms = 60_000,
  label = 'condition',
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!ENGINE)('adrenaline-engine swarm', () => {
  let root: string;
  let packDir: string;
  let packTorrent: TorrentInfo;
  let singleTorrent: TorrentInfo;
  let packTorrentB64: string;
  let seeder: Engine;
  const engines: Engine[] = [];

  const makeTorrent = (src: string, out: string, hybrid: boolean): TorrentInfo => {
    const args = ['--make-torrent', src, '--out', out, ...(hybrid ? ['--hybrid'] : [])];
    return JSON.parse(execFileSync(ENGINE!, args, { encoding: 'utf8' })) as TorrentInfo;
  };

  const newEngine = async (dataDir: string, extra: string[] = []) => {
    const e = new Engine(dataDir, extra);
    engines.push(e);
    await e.hello();
    return e;
  };

  const peers = () => [`127.0.0.1:${seeder.listenPort}`];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'adr-swarm-'));
    const content = join(root, 'content');
    packDir = join(content, 'Pack');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(content, 'single.bin'), randomBytes(3 * MiB));
    writeFileSync(join(packDir, POLISH), randomBytes(12 * MiB));
    writeFileSync(join(packDir, 'b.bin'), randomBytes(1 * MiB));
    if (!SKIP_BIG) {
      // > 4 GiB sparse file: exercises 64-bit offsets without using the disk.
      const fd = openSync(join(packDir, 'big.bin'), 'w');
      writeSync(fd, Buffer.from('x'));
      ftruncateSync(fd, 4 * 1024 * MiB + 17);
      closeSync(fd);
    }
    packTorrent = makeTorrent(packDir, join(root, 'pack.torrent'), true);
    singleTorrent = makeTorrent(join(content, 'single.bin'), join(root, 'single.torrent'), false);
    packTorrentB64 = readFileSync(join(root, 'pack.torrent')).toString('base64');
    expect(packTorrent.infoHashV1).toMatch(/^[0-9a-f]{40}$/);
    expect(packTorrent.infoHashV2).toMatch(/^[0-9a-f]{64}$/);
    expect(singleTorrent.infoHashV2).toBe('');

    seeder = await newEngine(join(root, 'seeder-data'));
    expect(seeder.listenPort).toBeGreaterThan(0);
    for (const [jobId, torrent] of [
      ['seed-pack', 'pack.torrent'],
      ['seed-single', 'single.torrent'],
    ] as const) {
      const b64 = readFileSync(join(root, torrent)).toString('base64');
      await seeder.client.request('add', { torrentBase64: b64, savePath: content }, jobId);
      const meta = await until(() => seeder.metadata(jobId), 10_000, 'seeder metadata');
      await seeder.client.request(
        'selectFiles',
        { files: meta.files.map((f) => ({ index: f.index, priority: 4 })) },
        jobId,
      );
    }
    await until(async () => (await seeder.status('seed-pack')).state === 'seeding', 120_000, 'seeder pack seeding');
    await until(async () => (await seeder.status('seed-single')).state === 'seeding', 30_000, 'seeder single seeding');
  });

  afterAll(async () => {
    for (const e of engines) await e.shutdown().catch(() => undefined);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('downloads one selected file of a pack (Polish name), reports only selected progress, verifies SHA-256', async () => {
    const leecher = await newEngine(join(root, 'leech1-data'));
    const save = join(root, 'leech1-save');
    const added = await leecher.client.request(
      'add',
      { torrentBase64: packTorrentB64, savePath: save, peers: peers() },
      'job-pack',
    );
    expect(added).toMatchObject({
      hasMetadata: true,
      infoHashV1: packTorrent.infoHashV1,
      infoHashV2: packTorrent.infoHashV2,
    });
    const meta = await until(() => leecher.metadata('job-pack'), 10_000, 'metadata');
    const target = meta.files.find((f) => f.path.endsWith(POLISH));
    expect(target).toBeDefined();
    expect(target!.path).toBe(`Pack/${POLISH}`);
    await leecher.client.request('selectFiles', { files: [{ index: target!.index, priority: 4 }] }, 'job-pack');

    const done = await until(
      async () => {
        const s = await leecher.status('job-pack');
        return s.state === 'seeding' ? s : undefined;
      },
      120_000,
      'download complete',
    );
    expect(done.selectedBytes).toBe(12 * MiB);
    expect(done.selectedDoneBytes).toBe(12 * MiB);
    expect(done.files).toEqual([{ index: target!.index, doneBytes: 12 * MiB }]);
    expect(leecher.states('job-pack')).toContain('downloaded');
    expect(leecher.events.some((e) => e.event === 'fileCompleted' && e.data.index === target!.index)).toBe(true);
    expect(sha256(join(save, 'Pack', POLISH))).toBe(sha256(join(packDir, POLISH)));
    const other = join(save, 'Pack', 'b.bin');
    expect(!existsSync(other) || sha256(other) !== sha256(join(packDir, 'b.bin'))).toBe(true);

    // FR19: seed policy stops seeding.
    await leecher.client.request('setSeedPolicy', { ratio: null, minutes: 0 }, 'job-pack');
    await until(
      () =>
        leecher.events.some((e) => e.event === 'state' && e.data.state === 'stopped' && e.data.reason === 'seed_limit'),
      10_000,
      'seed limit',
    );
    expect((await leecher.status('job-pack')).state).toBe('stopped');

    // A corrupted piece is found by recheck (download throttled so it is not repaired at once).
    await leecher.client.request('setLimits', { downloadBps: 1024, uploadBps: 0 });
    const file = join(save, 'Pack', POLISH);
    const fd = openSync(file, 'r+');
    writeSync(fd, randomBytes(64 * 1024), 0, 64 * 1024, 5 * MiB);
    closeSync(fd);
    await leecher.client.request('resume', {}, 'job-pack');
    const checksBefore = leecher.states('job-pack').filter((x) => x === 'checking').length;
    await leecher.client.request('recheck', {}, 'job-pack');
    await until(
      () => leecher.states('job-pack').filter((x) => x === 'checking').length > checksBefore,
      10_000,
      'checking',
    );
    const after = await until(
      async () => {
        const s = await leecher.status('job-pack');
        return s.state !== 'checking' && s.selectedDoneBytes < s.selectedBytes ? s : undefined;
      },
      30_000,
      'recheck result',
    );
    await leecher.client.request('setLimits', { downloadBps: 0, uploadBps: 0 });
    expect(after.selectedDoneBytes).toBeLessThan(12 * MiB);
  });

  it('pauses for real and resumes after being killed without starting over', async () => {
    const dataDir = join(root, 'leech2-data');
    const save = join(root, 'leech2-save');
    let leecher = await newEngine(dataDir, ['--resume-interval', '1']);
    await leecher.client.request('setLimits', { downloadBps: 1 * MiB, uploadBps: 0 });
    await leecher.client.request('add', { torrentBase64: packTorrentB64, savePath: save, peers: peers() }, 'job-kill');
    const meta = await until(() => leecher.metadata('job-kill'), 10_000, 'metadata');
    const target = meta.files.find((f) => f.path.endsWith(POLISH))!;
    await leecher.client.request('selectFiles', { files: [{ index: target.index, priority: 4 }] }, 'job-kill');

    await until(async () => (await leecher.status('job-kill')).selectedDoneBytes >= 3 * MiB, 60_000, '3 MiB');
    await expect(leecher.client.request('pause', {}, 'job-kill')).resolves.toMatchObject({ state: 'paused' });
    const paused = (await leecher.status('job-kill')).selectedDoneBytes;
    await sleep(3000);
    expect((await leecher.status('job-kill')).selectedDoneBytes).toBe(paused);
    expect(leecher.states('job-kill').at(-1)).toBe('paused');

    await leecher.client.request('resume', {}, 'job-kill');
    await until(
      async () => {
        const s = await leecher.status('job-kill');
        return s.selectedDoneBytes >= paused + 3 * MiB;
      },
      60_000,
      'more data',
    );
    // Simulated crash mid-download: measure, wait for the next periodic resume save, kill immediately.
    const beforeKill = (await leecher.status('job-kill')).selectedDoneBytes;
    const savedCount = leecher.events.filter((e) => e.event === 'resumeSaved').length;
    await until(
      () => leecher.events.filter((e) => e.event === 'resumeSaved').length > savedCount,
      10_000,
      'resume save',
    );
    leecher.kill();
    await sleep(500);

    leecher = await newEngine(dataDir, ['--resume-interval', '1']);
    await leecher.client.request(
      'add',
      { torrentBase64: packTorrentB64, savePath: save, peers: peers(), paused: true },
      'job-kill',
    );
    await leecher.client.request('selectFiles', { files: [{ index: target.index, priority: 4 }] }, 'job-kill');
    // A paused torrent reports "paused" while libtorrent still applies the resume data: wait until the restored
    // byte count is stable.
    let previous = -1;
    const restored = await until(
      async () => {
        const s = await leecher.status('job-kill');
        const stable = s.state !== 'checking' && s.selectedDoneBytes === previous && s.selectedDoneBytes > 0;
        previous = s.selectedDoneBytes;
        if (!stable) await sleep(400);
        return stable ? s : undefined;
      },
      30_000,
      'restored',
    );
    expect(restored.state).toBe('paused');
    expect(restored.selectedDoneBytes).toBeGreaterThanOrEqual(beforeKill * 0.9);

    await leecher.client.request('setLimits', { downloadBps: 0, uploadBps: 0 });
    await leecher.client.request('resume', {}, 'job-kill');
    await until(async () => (await leecher.status('job-kill')).state === 'seeding', 120_000, 'complete');
    expect(sha256(join(save, 'Pack', POLISH))).toBe(sha256(join(packDir, POLISH)));
  });

  it('fetches metadata for a magnet link', async () => {
    const leecher = await newEngine(join(root, 'leech3-data'));
    const save = join(root, 'leech3-save');
    const added = await leecher.client.request(
      'add',
      { magnet: singleTorrent.magnet, savePath: save, peers: peers() },
      'job-magnet',
    );
    expect(added.hasMetadata).toBe(false);
    const meta = await until(() => leecher.metadata('job-magnet'), 60_000, 'magnet metadata');
    expect(leecher.states('job-magnet')[0]).toBe('fetching_metadata');
    expect(meta.files).toEqual([{ index: 0, path: 'single.bin', size: 3 * MiB, pad: false }]);
    expect(meta.infoHashV1).toBe(singleTorrent.infoHashV1);
    // No selection yet: nothing is downloaded.
    await sleep(1500);
    expect(
      existsSync(join(save, 'single.bin')) &&
        sha256(join(save, 'single.bin')) === sha256(join(root, 'content', 'single.bin')),
    ).toBe(false);
    await leecher.client.request('selectFiles', { files: [{ index: 0, priority: 4 }] }, 'job-magnet');
    await until(async () => (await leecher.status('job-magnet')).state === 'seeding', 60_000, 'magnet complete');
    expect(sha256(join(save, 'single.bin'))).toBe(sha256(join(root, 'content', 'single.bin')));

    // Removing without files keeps the data; resume files of the job are deleted.
    await leecher.client.request('remove', { deleteFiles: false }, 'job-magnet');
    expect(existsSync(join(save, 'single.bin'))).toBe(true);
    expect(existsSync(join(root, 'leech3-data', 'job-magnet.resume'))).toBe(false);
  });

  it('answers protocol edge cases', async () => {
    const e = seeder.client;
    await expect(e.request('pause', {}, 'missing-job')).rejects.toMatchObject({ engineCode: 'JOB_NOT_FOUND' });
    await expect(e.request('add', { magnet: 'magnet:?xt=bad', savePath: root }, 'bad-magnet')).rejects.toMatchObject({
      engineCode: 'INVALID_MAGNET',
    });
    await expect(e.request('add', { torrentBase64: 'AAAA', savePath: root }, 'bad-torrent')).rejects.toMatchObject({
      engineCode: 'INVALID_TORRENT',
    });
    // Idempotent add: same jobId and torrent returns the existing job.
    await expect(
      e.request('add', { torrentBase64: packTorrentB64, savePath: root }, 'seed-pack'),
    ).resolves.toMatchObject({
      jobId: 'seed-pack',
    });
  });
});
