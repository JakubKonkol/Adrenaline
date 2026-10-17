import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import movies from '../fixtures/tmdb/search-movie.json' with { type: 'json' };
import series from '../fixtures/tmdb/search-tv.json' with { type: 'json' };
import movie from '../fixtures/tmdb/movie.json' with { type: 'json' };
import show from '../fixtures/tmdb/tv.json' with { type: 'json' };
import season from '../fixtures/tmdb/season.json' with { type: 'json' };
const caps = readFileSync('tests/fixtures/torznab/caps.xml', 'utf8');
const releases = `<?xml version="1.0"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item>
<title>Adrenaline.Adventures.S01E02.1080p.WEB-DL.x264-SMOKE</title><guid>smoke-release</guid><size>104857600</size>
<torznab:attr name="seeders" value="5"/><torznab:attr name="magneturl" value="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&amp;dn=Smoke.Episode.S01E02"/>
</item></channel></rss>`;

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
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
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
    await page.evaluate(
      async (downloadDir) => {
        await window.adrenaline.settings.update({ downloadDir });
      },
      join(userData, 'Downloads'),
    );

    // Stage 4: real preload/IPC/SQLite, provider HTTP replaced only in the test process.
    await page.route('https://image.tmdb.org/**', (route) => route.abort());
    await app.evaluate(
      (_electron, fixtures) => {
        globalThis.fetch = (input) => {
          const url = new URL(input instanceof Request ? input.url : input.toString());
          if (url.hostname === 'smoke.invalid')
            return Promise.resolve(
              new Response(url.searchParams.get('t') === 'caps' ? fixtures.caps : fixtures.releases, {
                headers: { 'Content-Type': 'application/xml' },
              }),
            );
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
      { movies, series, movie, show, season, caps, releases },
    );
    await page.getByRole('searchbox').fill('Night of the Living Dead');
    await page.getByRole('searchbox').press('Enter');
    await expect(page.getByRole('link', { name: /1968/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /1990/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('catalog.png') });
    await page.getByRole('link', { name: /Adrenaline Adventures/ }).click();
    await page.getByRole('link', { name: /Season 1/ }).click();
    await page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'New Trail' }) })
      .getByRole('button', { name: 'Find releases' })
      .click();
    await expect(page.getByTestId('screen-releases')).toContainText('Season 1 · Episode 2');
    await expect(page.getByTestId('screen-releases')).toContainText('You have no release sources turned on');
    const source = await page.evaluate(() =>
      window.adrenaline.sources.addCustom({
        name: 'Smoke source',
        endpoint: 'https://smoke.invalid/torznab',
        apiKey: null,
      }),
    );
    expect(source.ok).toBe(true);
    await page.getByRole('button', { name: 'Refresh', exact: true }).press('Enter');
    const releaseRow = page.getByRole('row').filter({ hasText: 'Adrenaline.Adventures.S01E02' });
    await expect(releaseRow).toBeVisible();
    await releaseRow.press('Enter');
    await expect(page.getByTestId('download-start')).toBeEnabled();
    // D-78: without an OpenSubtitles account subtitles start switched off; turning them on explains why they
    // cannot work yet, and the download goes ahead without them.
    const wantSubtitles = page.getByTestId('download-sub-enabled');
    await expect(wantSubtitles).toHaveAttribute('aria-checked', 'false');
    await wantSubtitles.click();
    await expect(page.getByTestId('download-sub-no-account')).toBeVisible();
    await expect(page.getByTestId('download-sub-lang')).toHaveValue('en');
    await wantSubtitles.click();
    await expect(page.getByTestId('download-sub-lang')).toHaveCount(0);
    await page.getByTestId('download-start').press('Enter');
    await expect(page.getByTestId('screen-job')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Subtitles', exact: true })).toBeVisible();
    // Subtitles can be fetched later and skipped again at any time.
    await page.getByTestId('subtitles-get').click();
    await expect(page.getByTestId('subtitles-skip')).toBeVisible();
    await page.getByTestId('subtitles-skip').click();
    await expect(page.getByTestId('subtitles-get')).toBeVisible();
    // Explorer calls are replaced in main: exercise the action without opening another window.
    await app.evaluate(({ shell }) => {
      shell.openPath = () => Promise.resolve('');
      shell.showItemInFolder = () => {};
    });
    await page.getByRole('button', { name: 'Open folder', exact: true }).press('Enter');
    const created = await page.evaluate(() => window.adrenaline.downloads.list());
    expect(created.ok).toBe(true);
    if (created.ok)
      for (const job of created.data)
        await page.evaluate((id) => window.adrenaline.downloads.remove({ jobId: id, deleteFiles: false }), job.id);

    await page.getByRole('link', { name: 'About' }).click();
    await expect(page.getByTestId('app-version')).toContainText(/\d+\.\d+\.\d+/);
    await expect(page.getByTestId('updater-status')).toContainText('Updates are off');
    await expect(page.getByTestId('engine-status')).toContainText('Running');
    await page.getByRole('button', { name: 'Copy diagnostics' }).press('Enter');
    await expect(page.getByText('Diagnostics copied')).toBeVisible();
    const diagnostics = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(diagnostics).not.toMatch(/smoke-test-token|Smoke|Adventures|magnet:|smoke.invalid|Downloads/);
    expect(JSON.parse(diagnostics)).toHaveProperty('versions.electron');
    await page.getByRole('link', { name: 'User guide' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'First run' })).toBeVisible();
    await page.getByRole('link', { name: 'Back', exact: true }).press('Enter');
    await page.getByRole('link', { name: 'Third-party licenses' }).press('Enter');
    await expect(page.locator('article')).toContainText('react@19.3.1');

    // 1.0: the TV tab. The server is off by default; turned on it answers the TV API, turned off it stops.
    // Use an OS-assigned port so a real TV server or the hardware demo can run alongside this test.
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '0.0.0.0', resolve);
    });
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('No TCP port assigned');
    const tvPort = address.port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
    await page.evaluate(async (port) => {
      const result = await window.adrenaline.settings.update({ tvServerPort: port });
      if (!result.ok) throw new Error('Cannot set the smoke TV port');
    }, tvPort);
    await page.getByRole('navigation').getByRole('link', { name: 'TV', exact: true }).click();
    await expect(page.getByTestId('screen-tv')).toBeVisible();
    await expect(page.getByTestId('tv-server-state')).toHaveCount(0);
    await page.getByTestId('tv-server-toggle').click();
    await expect(page.getByTestId('tv-server-state')).toHaveAttribute('data-state', 'running');
    const tvAddress = (await page.getByTestId('tv-server-url').textContent())!.trim();
    // Asked from the test process: the app's own fetch is stubbed against provider traffic in this test.
    const info = (await (await fetch(`http://${tvAddress}/api/v1/info`)).json()) as { app: string; apiVersion: number };
    expect(info).toMatchObject({ app: 'adrenaline', apiVersion: 1 });
    await page.getByTestId('tv-server-toggle').click();
    await expect(page.getByTestId('tv-server-state')).toHaveCount(0);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Library', exact: true })).toBeVisible();

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
      .getByRole('link', { name: /Downloads/ })
      .click();
    const row = page.getByTestId(`job-${jobId}`);
    await expect(row).toHaveAttribute('data-state', 'downloading');
    await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^[1-9]/, { timeout: 10_000 });
    await expect(page.getByTestId('nav-active-count')).toHaveText('1');
    await row.getByRole('button', { name: /Pause/ }).click();
    await expect(row).toHaveAttribute('data-state', 'paused');
    await expect(row.getByTestId('job-status')).toContainText('Paused');
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
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await expect(page.getByText(/only until the app is closed/)).toBeVisible();
      await page.getByTestId('tmdb-token').fill('smoke-test-token');
      await page.getByTestId('settings-save').click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Search', exact: true }).click();
    }
    await page.getByRole('searchbox').fill('Night of the Living Dead');
    await page.getByRole('searchbox').press('Enter');
    await expect(page.getByRole('link', { name: /1968/ })).toBeVisible();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByTestId('subtitle-lang')).toHaveValue('en');
    await expect(page.getByTestId('tmdb-token')).toHaveAttribute('placeholder', /Saved/);
    await page.getByTestId('setting-maxActiveDownloads').fill('0');
    await page.getByTestId('settings-save').click();
    await expect(page.getByRole('alert').first()).toContainText('Fix the highlighted');
    await page.getByTestId('setting-maxActiveDownloads').fill('2');
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // The paused job survived the restart (FR12) and resumes.
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /Downloads/ })
      .click();
    const restored = page.getByTestId(`job-${jobId}`);
    await expect(restored).toHaveAttribute('data-state', 'paused');
    await restored.getByRole('button', { name: /Resume/ }).click();
    await expect(restored).toHaveAttribute('data-state', 'downloading');
    // NFR01: click-to-painted-state, 20 samples while two other jobs are transferring.
    await page.evaluate(async () => {
      await window.adrenaline.settings.update({ maxActiveDownloads: 3 });
      await window.adrenaline.dev.addTestDownload({ name: 'Performance A' });
      await window.adrenaline.dev.addTestDownload({ name: 'Performance B' });
    });
    await expect(page.locator('[data-state="downloading"]')).toHaveCount(3);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const expected = i % 2 === 0 ? 'paused' : 'downloading';
      samples.push(
        await restored.evaluate(
          (element, state) =>
            new Promise<number>((resolve, reject) => {
              const start = performance.now();
              const timer = setTimeout(() => {
                observer.disconnect();
                reject(new Error('UI response timeout'));
              }, 2000);
              const observer = new MutationObserver(() => {
                if (element.getAttribute('data-state') === state) {
                  observer.disconnect();
                  clearTimeout(timer);
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
                }
              });
              observer.observe(element, { attributes: true, attributeFilter: ['data-state'] });
              const text = state === 'paused' ? 'Pause' : 'Resume';
              const button = [...element.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
              if (!button) {
                clearTimeout(timer);
                observer.disconnect();
                reject(new Error('Missing action'));
                return;
              }
              button.click();
            }),
          expected,
        ),
      );
    }
    const p95 = [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;
    process.stdout.write(`NFR01: 3 downloads, 20 samples, p95 ${p95.toFixed(1)} ms\n`);
    await test
      .info()
      .attach('ui-response.json', { body: JSON.stringify({ samples, p95 }), contentType: 'application/json' });
    expect(p95).toBeLessThan(200);
    await quit(app);
  } finally {
    await app?.close().catch(() => undefined);
    // Chromium can release profile handles shortly after Electron exits on Windows.
    rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
