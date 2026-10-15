// Dev helper: starts the built app (out/) with the fake engine and saves a screenshot of a route.
// Usage: node scripts/dev/screenshot.mjs [#/route] [out.png]
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from '@playwright/test';

const route = process.argv[2] ?? '';
const out = process.argv[3] ?? 'screenshot.png';
const app = await electron.launch({
  args: [resolve('out/main/index.js')],
  env: {
    ...process.env,
    ADRENALINE_USER_DATA: process.env.SHOT_USERDATA ?? resolve(tmpdir(), 'adrenaline-shot'),
    ADRENALINE_FAKE_ENGINE: '1',
    ADRENALINE_NO_JACKETT: '1',
  },
});
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text());
});
if (route) await page.evaluate((r) => (globalThis.location.hash = r), route);
await page.waitForTimeout(Number(process.env.SHOT_WAIT ?? 1500));
await page.screenshot({ path: out });
await app.close();
