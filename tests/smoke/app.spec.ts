import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';

const launch = (userData: string) =>
  electron.launch({
    args: [resolve('out/main/index.js')],
    env: {
      ...process.env,
      ADRENALINE_USER_DATA: userData,
      ADRENALINE_FAKE_ENGINE: '1',
      ADRENALINE_NO_JACKETT: '1',
    },
  });

/** "Quit" must stop everything (engine included) well within 15 s (etap 3, FR20). */
async function quit(app: ElectronApplication) {
  const start = Date.now();
  await app.close();
  expect(Date.now() - start).toBeLessThan(15_000);
}

test('first run, onboarding, settings kept after restart, isolated renderer', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'adrenaline-smoke-'));
  try {
    let app = await launch(userData);
    let page = await app.firstWindow();
    await expect(page).toHaveTitle(/Adrenaline/);
    await expect(page.getByTestId('titlebar')).toBeVisible();

    // NFR07: no Node in the renderer.
    const leaks = await page.evaluate(() => {
      const w = globalThis as unknown as Record<string, unknown>;
      return { require: typeof w['require'], process: typeof w['process'], bridge: typeof w['adrenaline'] };
    });
    expect(leaks).toEqual({ require: 'undefined', process: 'undefined', bridge: 'object' });

    // Onboarding: welcome → folder → subtitles (English) → TMDB key → skip OpenSubtitles → done.
    await expect(page.getByTestId('screen-onboarding')).toBeVisible();
    const next = page.getByTestId('onboarding-next');
    await next.click();
    await expect(page.getByTestId('download-dir')).not.toHaveValue('');
    await next.click();
    await page.getByTestId('subtitle-lang').selectOption('en');
    await next.click();
    await page.getByTestId('tmdb-token').fill('smoke-test-token');
    await next.click();
    await page.getByTestId('onboarding-skip').click();
    await next.click();
    await expect(page.getByTestId('screen-home')).toBeVisible();

    await page.getByRole('link', { name: 'O aplikacji' }).click();
    await expect(page.getByTestId('app-version')).toContainText(/\d+\.\d+\.\d+/);
    await expect(page.getByTestId('updater-status')).toContainText('wyłączone');
    await expect(page.getByTestId('engine-status')).toContainText('Działa');
    await quit(app);

    // Restart with the same profile: no onboarding, settings and the secret are kept.
    app = await launch(userData);
    page = await app.firstWindow();
    await expect(page.getByTestId('screen-home')).toBeVisible();
    await page.getByRole('link', { name: 'Ustawienia' }).click();
    await expect(page.getByTestId('subtitle-lang')).toHaveValue('en');
    await expect(page.getByTestId('tmdb-token')).toHaveAttribute('placeholder', /Zapisany/);
    await page.getByTestId('setting-maxActiveDownloads').fill('0');
    await page.getByTestId('settings-save').click();
    await expect(page.getByRole('alert').first()).toContainText('Popraw');
    await page.getByTestId('setting-maxActiveDownloads').fill('2');
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('Zapisano')).toBeVisible();
    await quit(app);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
