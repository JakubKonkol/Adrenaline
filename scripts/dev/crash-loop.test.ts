/**
 * NFR04 crash loop (etap 6.4): 20 cycles of "add a job → run → kill the engine and drop the app without shutdown →
 * start again", checking that no job is lost and none ends in an error. Uses the real engine when
 * ADRENALINE_ENGINE_PATH is set, otherwise the FakeEngine. No window is opened.
 *
 *   npm run crash-loop                                   (FakeEngine)
 *   ADRENALINE_ENGINE_PATH=<engine> npm run crash-loop   (real engine)
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type EngineInstance, EngineSupervisor, spawnEngine } from '../../src/main/engine/engine-process';
import { FakeEngine } from '../../src/main/engine/fake-engine';
import { nullLogger } from '../../src/main/logger';
import { openDatabase } from '../../src/main/persistence/db';
import { JobsRepository } from '../../src/main/persistence/repositories/jobs';
import { DownloadService } from '../../src/main/services/download-service';
import { SettingsService } from '../../src/main/services/settings-service';

const ENGINE = process.env['ADRENALINE_ENGINE_PATH'];
const CYCLES = Number(process.env['CRASH_LOOP_CYCLES'] ?? 20);

async function until(cond: () => boolean, ms = 15_000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('crash loop (NFR04)', () => {
  it(`keeps every job through ${CYCLES} crashes`, { timeout: 30 * 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'adr-crash-'));
    const dbPath = join(root, 'adrenaline.db');
    const fake = ENGINE ? null : new FakeEngine({ tickMs: 20, metadataDelayMs: 10, rate: 4 * 1024 * 1024 });
    const added: string[] = [];
    const report: string[] = [];
    try {
      for (let cycle = 1; cycle <= CYCLES; cycle++) {
        const db = openDatabase(dbPath, { log: nullLogger });
        const settings = new SettingsService(db, { downloadDir: join(root, 'Downloads'), randomPort: () => 50000 });
        const engine = new EngineSupervisor({
          launch: (): EngineInstance =>
            fake
              ? fake.launch()
              : spawnEngine({
                  binaryPath: ENGINE!,
                  args: ['--data-dir', join(root, 'engine'), '--listen-port', '0', '--no-dht', '--no-upnp'],
                  log: nullLogger,
                }),
          log: nullLogger,
          clientVersion: 'crash-loop',
          heartbeatMs: 1e9,
          maxCrashes: 1000,
        });
        const svc = new DownloadService({
          jobs: new JobsRepository(db),
          engine,
          settings,
          releaseInfo: () => null,
          endpointFor: () => Promise.resolve(null),
          log: nullLogger,
        });
        await engine.start();
        // Every job from earlier cycles is back (restored by the service on engine start).
        await until(() => svc.list().length === added.length);
        const name = `Crash Film ${cycle}`;
        const hash = createHash('sha1').update(`${root}-${cycle}`).digest('hex');
        const job = await svc.createDirect(
          { kind: 'movie', tmdbId: cycle, title: name, originalTitle: name, year: 2024 },
          `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}`,
          name,
        );
        added.push(job.id);
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 400));
        const states = svc.list().map((j) => j.state);
        report.push(`cycle ${cycle}: ${svc.list().length} jobs [${[...new Set(states)].join(', ')}]`);
        const broken = svc.list().filter((j) => j.state === 'error' || j.state === 'paused');
        if (broken.length)
          console.log(
            `cycle ${cycle}:`,
            broken.map((j) => `${j.target.title} ${j.state} ${j.errorCode ?? ''} ${j.pauseReason ?? ''}`).join(' | '),
          );
        expect(states).not.toContain('error');
        // Crash: the engine is killed and the app is dropped without its shutdown (no persistAll, no db.close()).
        engine.kill();
        engine.removeAll();
        svc.removeAll();
        await new Promise((r) => setTimeout(r, 100));
      }
      const db = openDatabase(dbPath, { log: nullLogger });
      const jobs = new JobsRepository(db).active();
      expect(jobs.map((j) => j.id).sort()).toEqual([...added].sort());
      expect(jobs.filter((j) => j.state === 'error')).toEqual([]);
      db.close();
      console.log(report.join('\n'));
      console.log(`${CYCLES} cycles, ${jobs.length} jobs kept, engine: ${ENGINE ? 'real' : 'fake'}`);
    } finally {
      // Best effort: the deliberately abandoned connections may still hold the database file on Windows.
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* left in the temp folder */
      }
    }
  });
});
