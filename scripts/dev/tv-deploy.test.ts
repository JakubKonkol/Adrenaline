/**
 * Manual Deploy to TV run (not part of `npm test`): the real DeployService with the real adb against a TV or an
 * Android TV emulator, using resources/tv (npm run tv:prepare + APK + scripts/tv/write-manifest.mjs).
 *
 *   TV_ADB=…\platform-tools\adb.exe TV_ADDRESS=127.0.0.1 TV_PORT=5561 TV_SERVER=http://192.168.1.20:18790 \
 *     npx vitest run -c scripts/dev/vitest.tv-demo.config.ts scripts/dev/tv-deploy.test.ts
 *
 * The emulator's adb port is on loopback, which the TV tab does not accept as a TV address; this script calls the
 * service directly. The handshake step waits for any TV talking to the demo server (scripts/dev/tv-demo.test.ts).
 */
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFileLogger } from '../../src/main/logger';
import { DeployService } from '../../src/main/tv/deploy/deploy-service';

it('deploys the Android TV app', async () => {
  const env = process.env;
  const log = createFileLogger({ dir: join(process.cwd(), 'test-results', 'tv-deploy'), homeDir: '', mirror: true });
  const deploy = new DeployService({
    tvDir: join(process.cwd(), 'resources', 'tv'),
    workDir: join(process.cwd(), 'test-results', 'tv-deploy', 'work'),
    toolchain: () => ({ adb: env['TV_ADB']!, sdb: null, tizen: null, tizenStudio: null, profiles: [] }),
    serverUrl: () => env['TV_SERVER']!,
    waitForTv: async (_address, since) => {
      // Any TV app calling /api/v1/info on the demo server after the launch counts.
      for (let i = 0; i < 120; i++) {
        const res = await fetch(`${env['TV_SERVER']}/api/v1/info`).catch(() => null);
        if (res?.ok && Date.now() - since > 20_000) return true;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return false;
    },
    log,
  });
  deploy.on('state', (s) => log.info(`deploy state: ${s.step} ${s.status} ${s.errorCode ?? ''} ${s.detail ?? ''}`));
  deploy.start({ platform: 'android', address: env['TV_ADDRESS']!, port: Number(env['TV_PORT']), pairing: null });
  for (;;) {
    const s = deploy.state!;
    if (['done', 'error', 'cancelled'].includes(s.status)) {
      expect(s.status).toBe('done');
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
});
