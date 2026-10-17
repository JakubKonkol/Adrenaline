/** Opt-in hardware check against the running demo server; no credentials are read or printed. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { DeployService } from '../../src/main/tv/deploy/deploy-service';
import { nullLogger } from '../../src/main/logger';

it.skipIf(!process.env['TV_TIZEN_ADDRESS'] || !process.env['TV_DEMO_DB'] || !process.env['TV_SERVER'])(
  'installs and launches on the selected Samsung, with authenticated handshake',
  async () => {
    const env = process.env;
    const db = new DatabaseSync(env['TV_DEMO_DB']!, { readOnly: true });
    const events: unknown[] = [];
    try {
      const deploy = new DeployService({
        tvDir: join(process.cwd(), 'resources/tv'),
        workDir: join(env['APPDATA']!, 'adrenaline/tv-deploy'),
        toolchain: () => ({ adb: null, sdb: null, tizen: null, tizenStudio: null, profiles: [] }),
        serverUrl: () => env['TV_SERVER']!,
        waitForTv: async (address, since, signal) => {
          const deadline = Date.now() + 120_000;
          while (!signal.aborted && Date.now() < deadline) {
            if (db.prepare('SELECT 1 FROM tv_devices WHERE last_address = ? AND last_seen_at >= ?').get(address, since))
              return true;
            await new Promise((r) => setTimeout(r, 500));
          }
          return false;
        },
        log: nullLogger,
      });
      deploy.on('state', (state) => {
        events.push(state);
        writeFileSync('test-results/tizen-deploy.json', JSON.stringify(events, null, 2));
      });
      deploy.start({ platform: 'tizen', address: env['TV_TIZEN_ADDRESS']!, profile: '' });
      while (deploy.state?.status === 'running' || deploy.state?.status === 'action')
        await new Promise((r) => setTimeout(r, 500));
      expect(deploy.state).toMatchObject({ status: 'done' });
    } finally {
      db.close();
    }
  },
  600_000,
);
