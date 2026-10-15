/**
 * NFR11 measurement (etap 6): memory of adrenaline-engine while downloading 1 and then 3 torrents of 256 MiB from a
 * local seeder. Windows only (reads Private Bytes / Working Set with PowerShell). Manual:
 *   ADRENALINE_ENGINE_PATH=<engine.exe> npx vitest run -c scripts/dev/vitest.crash-loop.config.ts scripts/dev/memory.test.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineClient } from '../../src/main/engine/engine-client';
import { nullLogger } from '../../src/main/logger';

const ENGINE = process.env['ADRENALINE_ENGINE_PATH'];
const MiB = 1024 * 1024;
const SIZE = 256 * MiB;

function start(dataDir: string) {
  const child = spawn(ENGINE!, ['--data-dir', dataDir, '--listen-port', '0', '--no-dht', '--no-upnp', '--test-mode'], {
    windowsHide: true,
  });
  const lines: ((l: string) => void)[] = [];
  let buf = '';
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      for (const l of lines) l(line);
    }
  });
  const client = new EngineClient({
    transport: {
      write: (l) => void child.stdin.write(`${l}\n`),
      onLine: (l) => void lines.push(l),
      onClose: (l) => void child.on('exit', l),
    },
    log: nullLogger,
    timeoutMs: 30_000,
  });
  return { child, client };
}

function memory(pid: number): { privateMiB: number; workingSetMiB: number } {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid}; "$($p.PrivateMemorySize64) $($p.WorkingSet64)"`],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  const [priv, ws] = out.split(' ').map(Number);
  return { privateMiB: Math.round((priv ?? 0) / MiB), workingSetMiB: Math.round((ws ?? 0) / MiB) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!ENGINE || process.platform !== 'win32')('engine memory (NFR11)', () => {
  it('measures 1 and 3 parallel downloads', { timeout: 20 * 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'adr-mem-'));
    try {
      const content = join(root, 'content');
      mkdirSync(content);
      const torrents: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const file = join(content, `film${i}.bin`);
        const fd = openSync(file, 'w');
        for (let off = 0; off < SIZE; off += 16 * MiB) writeSync(fd, randomBytes(16 * MiB));
        closeSync(fd);
        execFileSync(ENGINE!, ['--make-torrent', file, '--out', join(root, `f${i}.torrent`)], { windowsHide: true });
        torrents.push(
          execFileSync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `[Convert]::ToBase64String([IO.File]::ReadAllBytes('${join(root, `f${i}.torrent`)}'))`,
            ],
            { encoding: 'utf8', maxBuffer: 64 * MiB, windowsHide: true },
          ).trim(),
        );
      }
      const seeder = start(join(root, 'seed-data'));
      const hello = await seeder.client.hello('mem');
      let port = hello.listenPort ?? 0;
      for (let i = 0; port === 0 && i < 40; i++) {
        await sleep(250);
        port = (await seeder.client.hello('mem')).listenPort ?? 0;
      }
      for (let i = 0; i < 3; i++) {
        const id = `seed-${i}`;
        await seeder.client.request('add', { torrentBase64: torrents[i]!, savePath: content }, id);
        await seeder.client.request('selectFiles', { files: [{ index: 0, priority: 4 }] }, id);
      }
      for (let ok = false; !ok; await sleep(500)) {
        ok = (await seeder.client.request('snapshot', {})).jobs.every((j) => j.state === 'seeding');
      }

      const results: string[] = [];
      for (const count of [1, 3]) {
        const leech = start(join(root, `leech${count}-data`));
        await leech.client.hello('mem');
        const idle = memory(leech.child.pid!);
        for (let i = 0; i < count; i++) {
          const id = `job-${count}-${i}`;
          await leech.client.request(
            'add',
            { torrentBase64: torrents[i]!, savePath: join(root, `save${count}`), peers: [`127.0.0.1:${port}`] },
            id,
          );
          await leech.client.request('selectFiles', { files: [{ index: 0, priority: 4 }] }, id);
        }
        let peakPrivate = 0;
        let peakWs = 0;
        const t0 = Date.now();
        for (let done = false; !done; await sleep(500)) {
          const m = memory(leech.child.pid!);
          peakPrivate = Math.max(peakPrivate, m.privateMiB);
          peakWs = Math.max(peakWs, m.workingSetMiB);
          done = (await leech.client.request('snapshot', {})).jobs.every((j) => j.state === 'seeding');
        }
        results.push(
          `${count} × 256 MiB: idle private ${idle.privateMiB} MiB, peak private ${peakPrivate} MiB, peak working set ${peakWs} MiB, ${Math.round((Date.now() - t0) / 1000)} s`,
        );
        leech.child.kill();
        await sleep(500);
      }
      seeder.child.kill();
      console.log(results.join('\n'));
      expect(results).toHaveLength(2);
    } finally {
      await sleep(500);
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* temp */
      }
    }
  });
});
