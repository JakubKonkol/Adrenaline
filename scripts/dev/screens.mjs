// Dev helper: screenshots of the main screens with the fake engine (run under xvfb on Linux, no window shown).
// Usage: node scripts/dev/screens.mjs <out-dir>
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const out = resolve(process.argv[2] ?? 'screens');
mkdirSync(out, { recursive: true });
const app = await electron.launch({
  args: [resolve('out/main/index.js')],
  env: {
    ...process.env,
    ADRENALINE_USER_DATA: mkdtempSync(join(tmpdir(), 'adr-screens-')),
    ADRENALINE_FAKE_ENGINE: '1',
    ADRENALINE_NO_JACKETT: '1',
  },
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1280, height: 820 });
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${name}.png`) });
};
await shot('01-onboarding');
const next = page.getByTestId('onboarding-next');
await next.click();
await next.click();
await next.click();
await next.click();
await page.getByTestId('onboarding-skip').click();
await shot('02-onboarding-sources');
await page.getByTestId('onboarding-skip').click();
await next.click();
const add = (name) => page.evaluate((n) => globalThis.adrenaline.dev.addTestDownload({ name: n }), name);
await add('Night of the Living Dead');
await add('Metropolis');
await add('Nosferatu');
await page
  .getByRole('navigation')
  .getByRole('link', { name: /Downloads/ })
  .click();
await page.waitForTimeout(2500);
await shot('03-downloads');
await page.locator('[data-testid^="job-"] a').first().click();
await shot('04-job-details');
await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
await page.getByTestId('sources-section').scrollIntoViewIfNeeded();
await shot('05-settings-sources');
await app.close();
