// Dev helper: screenshots of the desktop Library and TV tabs (fake engine, no network).
// Usage (Linux): npm run build && xvfb-run -a node scripts/dev/desktop-tv-screens.mjs [out-dir]
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const out = resolve(process.argv[2] ?? 'desktop-tv-screens');
mkdirSync(out, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'adr-tvshots-'));

const app = await electron.launch({
  args: [resolve('out/main/index.js')],
  env: {
    ...process.env,
    ADRENALINE_USER_DATA: userData,
    ADRENALINE_FAKE_ENGINE: '1',
    ADRENALINE_FAKE_RATE_MIB: '400',
    ADRENALINE_NO_JACKETT: '1',
  },
});
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.setViewportSize({ width: 1280, height: 860 });
await page.evaluate(async () => {
  const api = globalThis.adrenaline;
  await api.settings.update({ onboardingDone: true, tvServerEnabled: true });
  await api.dev.addTestDownload({ name: 'Glass Harbor' });
  await api.dev.addTestDownload({ name: 'Quiet Hours' });
});
await page.waitForTimeout(4000);
for (const [route, name] of [
  ['#/library', 'library'],
  ['#/tv', 'tv'],
]) {
  await page.evaluate((r) => (globalThis.location.hash = r), route);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  console.log('saved', name);
}
await app.close();
rmSync(userData, { recursive: true, force: true });
