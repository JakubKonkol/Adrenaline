import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('app starts with an isolated renderer', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'adrenaline-smoke-'));
  const app = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: {
      ...process.env,
      ADRENALINE_USER_DATA: userData,
      ADRENALINE_FAKE_ENGINE: '1',
      ADRENALINE_NO_JACKETT: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle(/Adrenaline/);
    await expect(page.getByTestId('titlebar')).toBeVisible();
    await expect(page.getByTestId('app-version')).toContainText(/\d+\.\d+\.\d+/);

    // NFR07: no Node in the renderer.
    const leaks = await page.evaluate(() => {
      const w = globalThis as unknown as Record<string, unknown>;
      return { require: typeof w['require'], process: typeof w['process'], bridge: typeof w['adrenaline'] };
    });
    expect(leaks).toEqual({ require: 'undefined', process: 'undefined', bridge: 'object' });
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
