import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nullLogger } from '../logger';
import { openDatabase } from '../persistence/db';
import { Secrets } from '../secrets';
import { TorznabClient } from '../providers/torznab/torznab-client';
import { JackettManager } from './jackett-manager';

/**
 * Manual live check with the real bundled Jackett (vendor/jackett, `node scripts/fetch-jackett.mjs`):
 * ADRENALINE_LIVE_JACKETT=1 npx vitest run src/main/jackett/jackett-manager.live.test.ts
 * Reaches the YTS website when adding the indexer. Not part of `npm test` / CI.
 */
const EXE = resolve('vendor/jackett/JackettConsole.exe');
const enabled = process.env['ADRENALINE_LIVE_JACKETT'] === '1' && existsSync(EXE);

describe.skipIf(!enabled)('JackettManager live', () => {
  it('starts the real Jackett, adds YTS and searches Torznab', { timeout: 120_000 }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'adr-jackett-live-'));
    const db = openDatabase(':memory:', { log: nullLogger });
    const secrets = new Secrets(
      db,
      { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
      nullLogger,
    );
    const manager = new JackettManager({ exePath: EXE, dataDir, secrets, log: nullLogger });
    try {
      const conn = await manager.ensureRunning();
      expect(manager.status.state).toBe('running');
      await conn.admin.addIndexer('yts');
      const hits = await new TorznabClient().search(
        {
          id: 'jackett:yts',
          name: 'YTS',
          endpoint: `${conn.baseUrl}/api/v2.0/indexers/yts/results/torznab/api`,
          apiKey: () => conn.apiKey,
        },
        { t: 'movie', imdbid: 'tt0063350' },
      );
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.magnet ?? hits[0]!.link).toBeTruthy();
      await conn.admin.removeIndexer('yts');
    } finally {
      await manager.stop();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
