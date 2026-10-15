import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import movies from '../fixtures/tmdb/search-movie.json' with { type: 'json' };
import series from '../fixtures/tmdb/search-tv.json' with { type: 'json' };
import movie from '../fixtures/tmdb/movie.json' with { type: 'json' };
import show from '../fixtures/tmdb/tv.json' with { type: 'json' };
import season from '../fixtures/tmdb/season.json' with { type: 'json' };

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
    // Sources step (etap 5): Jackett is disabled in the smoke test (ADRENALINE_NO_JACKETT), so skip it.
    await expect(page.getByTestId('source-toggle-jackett:yts')).toBeVisible();
    await page.getByTestId('onboarding-skip').click();
    await next.click();
    await expect(page.getByTestId('screen-home')).toBeVisible();

    // Stage 4: real preload/IPC/SQLite, provider HTTP replaced only in the test process.
    await page.route('https://image.tmdb.org/**', (route) => route.abort());
    await app.evaluate(
      (_electron, fixtures) => {
        globalThis.fetch = (input) => {
          const url = new URL(input instanceof Request ? input.url : input.toString());
          if (url.hostname !== 'api.themoviedb.org')
            return Promise.reject(new Error('Unexpected network request in smoke'));
          const body =
            url.pathname === '/3/search/movie'
              ? fixtures.movies
              : url.pathname === '/3/search/tv'
                ? fixtures.series
                : url.pathname === '/3/movie/10331'
                  ? fixtures.movie
                  : url.pathname === '/3/tv/900001'
                    ? fixtures.show
                    : url.pathname === '/3/tv/900001/season/1'
                      ? fixtures.season
                      : null;
          return Promise.resolve(Response.json(body, { status: body ? 200 : 404 }));
        };
      },
      { movies, series, movie, show, season },
    );
    await page.getByRole('searchbox').fill('Night of the Living Dead');
    await page.getByRole('searchbox').press('Enter');
    await expect(page.getByRole('link', { name: /1968/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /1990/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('catalog.png') });
    await page.getByRole('link', { name: /Przygody Adrenaliny/ }).click();
    await page.getByRole('link', { name: /Sezon 1/ }).click();
    await page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Nowy szlak' }) })
      .getByRole('button', { name: 'Szukaj wydań' })
      .click();
    await expect(page.getByTestId('screen-releases')).toContainText('Sezon 1 · Odcinek 2');
    await expect(page.getByTestId('screen-releases')).toContainText('Nie masz włączonych źródeł');

    await page.getByRole('link', { name: 'O aplikacji' }).click();
    await expect(page.getByTestId('app-version')).toContainText(/\d+\.\d+\.\d+/);
    await expect(page.getByTestId('updater-status')).toContainText('wyłączone');
    await expect(page.getByTestId('engine-status')).toContainText('Działa');

    // Etap 6.6: a job through the hidden test API (fake engine only) → progress → pause → kept after restart.
    const added = await page.evaluate(async () => {
      const w = globalThis as unknown as {
        adrenaline: { dev: { addTestDownload(i: { name: string }): Promise<{ ok: boolean; data?: { id: string } }> } };
      };
      return w.adrenaline.dev.addTestDownload({ name: 'Smoke Film' });
    });
    expect(added.ok).toBe(true);
    const jobId = added.data!.id;
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /Pobrane/ })
      .click();
    const row = page.getByTestId(`job-${jobId}`);
    await expect(row).toHaveAttribute('data-state', 'downloading');
    await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^[1-9]/, { timeout: 10_000 });
    await expect(page.getByTestId('nav-active-count')).toHaveText('1');
    await row.getByRole('button', { name: /Wstrzymaj/ }).click();
    await expect(row).toHaveAttribute('data-state', 'paused');
    await expect(row.getByTestId('job-status')).toContainText('Wstrzymane');
    await quit(app);

    // Restart with the same profile: no onboarding, settings and the secret are kept.
    app = await launch(userData);
    page = await app.firstWindow();
    await expect(page.getByTestId('screen-home')).toBeVisible();
    // The cached search must survive restart and work without any provider network access.
    await page.route('https://image.tmdb.org/**', (route) => route.abort());
    await app.evaluate(() => {
      globalThis.fetch = () => Promise.reject(new Error('Provider network is disabled after restart'));
    });
    // Secrets persist with OS encryption (DPAPI on Windows). Without it (Linux under xvfb, no keyring) they are
    // kept for the session only and Settings says so (etap 3.3): the key is entered again there.
    const encrypted = await page.evaluate(async () => {
      const w = globalThis as unknown as {
        adrenaline: {
          settings: { secretsStatus(): Promise<{ ok: boolean; data?: { encryptionAvailable: boolean } }> };
        };
      };
      return (await w.adrenaline.settings.secretsStatus()).data?.encryptionAvailable ?? false;
    });
    if (!encrypted) {
      await page.getByRole('link', { name: 'Ustawienia', exact: true }).click();
      await expect(page.getByText(/tylko do zamknięcia aplikacji/)).toBeVisible();
      await page.getByTestId('tmdb-token').fill('smoke-test-token');
      await page.getByTestId('settings-save').click();
      await expect(page.getByText('Zapisano')).toBeVisible();
      await page.getByRole('link', { name: 'Szukaj', exact: true }).click();
    }
    await page.getByRole('searchbox').fill('Night of the Living Dead');
    await page.getByRole('searchbox').press('Enter');
    await expect(page.getByRole('link', { name: /1968/ })).toBeVisible();
    await page.getByRole('link', { name: 'Ustawienia', exact: true }).click();
    await expect(page.getByTestId('subtitle-lang')).toHaveValue('en');
    await expect(page.getByTestId('tmdb-token')).toHaveAttribute('placeholder', /Zapisany/);
    await page.getByTestId('setting-maxActiveDownloads').fill('0');
    await page.getByTestId('settings-save').click();
    await expect(page.getByRole('alert').first()).toContainText('Popraw');
    await page.getByTestId('setting-maxActiveDownloads').fill('2');
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('Zapisano')).toBeVisible();

    // The paused job survived the restart (FR12) and resumes.
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /Pobrane/ })
      .click();
    const restored = page.getByTestId(`job-${jobId}`);
    await expect(restored).toHaveAttribute('data-state', 'paused');
    await restored.getByRole('button', { name: /Wznów/ }).click();
    await expect(restored).toHaveAttribute('data-state', 'downloading');
    await quit(app);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
