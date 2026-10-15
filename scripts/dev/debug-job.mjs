// Dev helper: prints a test job as the renderer sees it (fake engine, run under xvfb).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const app = await electron.launch({
  args: [resolve('out/main/index.js')],
  env: {
    ...process.env,
    ADRENALINE_USER_DATA: mkdtempSync(join(tmpdir(), 'adr-dbg-')),
    ADRENALINE_FAKE_ENGINE: '1',
    ADRENALINE_NO_JACKETT: '1',
  },
});
const page = await app.firstWindow();
const job = await page.evaluate(async () => {
  const a = globalThis.adrenaline;
  await a.settings.update({ onboardingDone: true });
  const added = await a.dev.addTestDownload({ name: 'Debug' });
  await new Promise((r) => setTimeout(r, 2500));
  return a.downloads.get({ jobId: added.data.id });
});
console.log(JSON.stringify(job.data, null, 1).slice(0, 1500));
await app.close();
