import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReleaseSession } from '@shared/contracts/releases';
import { JackettManager } from '../jackett/jackett-manager';
import { nullLogger } from '../logger';
import { openDatabase } from '../persistence/db';
import { CacheRepository } from '../persistence/repositories/cache';
import { SourcesRepository } from '../persistence/repositories/sources';
import { TorznabClient } from '../providers/torznab/torznab-client';
import { Secrets } from '../secrets';
import { ReleaseSearchService } from './release-search-service';
import { SourcesService } from './sources-service';

/**
 * Manual live test of etap 5 (FR03): the real bundled Jackett with the four default public indexers plus one
 * broken custom endpoint; a public-domain film (Night of the Living Dead, 1968).
 * ADRENALINE_LIVE_JACKETT=1 npx vitest run src/main/services/release-search.live.test.ts
 */
const EXE = resolve('vendor/jackett/JackettConsole.exe');
const enabled = process.env['ADRENALINE_LIVE_JACKETT'] === '1' && existsSync(EXE);

describe.skipIf(!enabled)('release search live', () => {
  it('searches ≥3 real sources; a broken source does not remove the others', { timeout: 240_000 }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'adr-live-search-'));
    const db = openDatabase(':memory:', { log: nullLogger });
    const secrets = new Secrets(
      db,
      { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
      nullLogger,
    );
    const jackett = new JackettManager({ exePath: EXE, dataDir, secrets, log: nullLogger });
    const torznab = new TorznabClient();
    const repo = new SourcesRepository(db);
    const sources = new SourcesService({ repo, jackett, secrets, torznab, log: nullLogger });
    try {
      const enabledIds: string[] = [];
      for (const s of sources.list()) {
        try {
          await sources.setEnabled(s.id, true);
          enabledIds.push(s.id);
        } catch (error) {
          console.log(`could not enable ${s.id}:`, (error as Error).message);
        }
      }
      // A broken custom endpoint, added directly (addCustom would refuse it).
      repo.upsert({
        id: 'custom:broken',
        kind: 'torznab_custom',
        name: 'Broken',
        endpoint: 'http://127.0.0.1:9/api',
        indexerId: null,
        enabled: true,
        apiKeySecret: null,
        health: 'unknown',
        healthCode: null,
        checkedAt: null,
        createdAt: Date.now(),
      });
      const search = new ReleaseSearchService({ sources, torznab, cache: new CacheRepository(db), log: nullLogger });
      const updates: ReleaseSession[] = [];
      search.on('update', (u) => updates.push(u));
      const started = Date.now();
      search.start({
        kind: 'movie',
        tmdbId: 10331,
        imdbId: 'tt0063350',
        title: 'Noc żywych trupów',
        originalTitle: 'Night of the Living Dead',
        year: 1968,
      });
      while (!updates.at(-1)?.done) await new Promise((r) => setTimeout(r, 200));
      const last = updates.at(-1)!;
      const firstResult = updates.find((u) => u.releases.length > 0);
      console.log(
        JSON.stringify(
          {
            enabled: enabledIds,
            sources: last.sources.map(
              (s) => `${s.name}: ${s.state}${s.errorCode ? ` (${s.errorCode})` : ''} ${s.count}`,
            ),
            releases: last.releases.length,
            multiSource: last.releases.filter((r) => new Set(r.sources.map((s) => s.id)).size > 1).length,
            firstResultMs: firstResult ? firstResult.startedAt && updates.indexOf(firstResult) : null,
            totalMs: Date.now() - started,
            top: last.releases
              .slice(0, 5)
              .map((r) => `${r.match.score} ${r.name} [${r.sources.map((s) => s.name).join('+')}]`),
          },
          null,
          2,
        ),
      );
      const answered = last.sources.filter((s) => s.state === 'ok' || s.state === 'empty');
      expect(answered.length).toBeGreaterThanOrEqual(3);
      expect(last.sources.find((s) => s.id === 'custom:broken')?.state).toBe('error');
      expect(last.releases.length).toBeGreaterThan(0);
      expect(last.outcome).toBe('results');
    } finally {
      await jackett.stop();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
