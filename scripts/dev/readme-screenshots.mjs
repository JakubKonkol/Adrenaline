// Dev helper: README screenshots (docs/screenshots) with the fake engine and synthetic catalog/source data.
// Titles are public-domain films; posters are generated here. Nothing touches the network.
// Usage (Linux): npm run build && xvfb-run -a node scripts/dev/readme-screenshots.mjs [out-dir]
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const out = resolve(process.argv[2] ?? 'docs/screenshots');
mkdirSync(out, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'adr-readme-'));

const films = [
  { id: 10331, title: 'Night of the Living Dead', year: 1968, popularity: 40, colors: ['#3a1c1c', '#b33a2b'] },
  { id: 653, title: 'Nosferatu', year: 1922, popularity: 30, colors: ['#1b2433', '#5d7aa8'] },
  { id: 19, title: 'Metropolis', year: 1927, popularity: 28, colors: ['#2e2a1a', '#c8a43c'] },
  { id: 961, title: 'The General', year: 1926, popularity: 18, colors: ['#1f2a22', '#6f9a6a'] },
  { id: 234, title: 'The Cabinet of Dr. Caligari', year: 1920, popularity: 16, colors: ['#2b1d33', '#9a5fb0'] },
  { id: 19185, title: 'Night of the Living Dead', year: 1990, popularity: 12, colors: ['#262626', '#e06a2c'] },
];
const overview = {
  10331:
    'A group of strangers barricade themselves in a remote farmhouse in rural Pennsylvania while the recently dead return to life outside.',
};
const movieRow = (f) => ({
  id: f.id,
  title: f.title,
  original_title: f.title,
  release_date: `${f.year}-10-04`,
  poster_path: `/poster-${f.id}.jpg`,
  overview: overview[f.id] ?? 'A public-domain classic used in the README screenshots.',
  popularity: f.popularity,
});
const fixtures = {
  search: { page: 1, results: films.map(movieRow), total_pages: 1, total_results: films.length },
  tv: { page: 1, results: [], total_pages: 1, total_results: 0 },
  details: {
    ...movieRow(films[0]),
    genres: [
      { id: 27, name: 'Horror' },
      { id: 53, name: 'Thriller' },
    ],
    runtime: 96,
    external_ids: { imdb_id: 'tt0063350' },
  },
};

const hash = (n) => n.toString(16).padStart(40, 'a');
const release = (name, sizeMiB, seeders, n) =>
  `<item><title>${name}</title><guid>readme-${n}</guid><size>${sizeMiB * 1024 * 1024}</size>` +
  `<torznab:attr name="seeders" value="${seeders}"/>` +
  `<torznab:attr name="magneturl" value="magnet:?xt=urn:btih:${hash(n)}&amp;dn=${name}"/></item>`;
const releases = `<?xml version="1.0"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${[
  release('Night.of.the.Living.Dead.1968.2160p.UHD.BluRay.REMUX.HDR.HEVC-ARCHIVE', 48_000, 21, 1),
  release('Night.of.the.Living.Dead.1968.1080p.BluRay.x264-CLASSIC', 7_900, 64, 2),
  release('Night.of.the.Living.Dead.1968.1080p.WEB-DL.H264-PUBLIC', 3_200, 38, 3),
  release('Night.of.the.Living.Dead.1968.720p.BluRay.x264-RESTORED', 2_100, 17, 4),
  release('Night.of.the.Living.Dead.1968.480p.DVDRip.XviD-OLDIE', 700, 6, 5),
  release('Night.of.the.Living.Dead.1990.1080p.BluRay.x264-REMAKE', 8_400, 29, 6),
].join('')}</channel></rss>`;
const caps = `<?xml version="1.0"?><caps><searching><search available="yes" supportedParams="q"/><movie-search available="yes" supportedParams="q,imdbid,tmdbid"/><tv-search available="yes" supportedParams="q,season,ep"/></searching><categories><category id="2000" name="Movies"/><category id="5000" name="TV"/></categories></caps>`;

const poster = (f) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750">` +
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${f.colors[1]}"/>` +
  `<stop offset="1" stop-color="${f.colors[0]}"/></linearGradient></defs><rect width="500" height="750" fill="url(#g)"/>` +
  `<circle cx="380" cy="170" r="90" fill="#ffffff" opacity="0.12"/>` +
  `<text x="40" y="560" font-family="Georgia, serif" font-size="46" fill="#fff" opacity="0.95">${f.title
    .split(' ')
    .reduce((lines, word) => {
      const last = lines[lines.length - 1];
      if (last && (last + ' ' + word).length <= 14) lines[lines.length - 1] = last + ' ' + word;
      else lines.push(word);
      return lines;
    }, [])
    .map((line, i) => `<tspan x="40" dy="${i ? 54 : 0}">${line}</tspan>`)
    .join('')}</text>` +
  `<text x="40" y="700" font-family="Georgia, serif" font-size="28" fill="#fff" opacity="0.7">${f.year}</text></svg>`;

const app = await electron.launch({
  args: [resolve('out/main/index.js')],
  env: {
    ...process.env,
    ADRENALINE_USER_DATA: userData,
    ADRENALINE_FAKE_ENGINE: '1',
    ADRENALINE_FAKE_RATE_MIB: '60',
    ADRENALINE_NO_JACKETT: '1',
  },
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.emulateMedia({ colorScheme: 'dark' });
  // Posters are answered inside Electron (Playwright's request routing does not see them).
  await app.evaluate(
    ({ protocol, net }, posters) => {
      protocol.handle('https', (request) => {
        const url = new URL(request.url);
        if (url.hostname !== 'image.tmdb.org') return net.fetch(request, { bypassCustomProtocolHandlers: true });
        const id = /poster-(\d+)/.exec(url.pathname)?.[1];
        const svg = id ? posters[id] : undefined;
        return svg
          ? new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
          : new Response(null, { status: 404 });
      });
    },
    Object.fromEntries(films.map((f) => [f.id, poster(f)])),
  );
  await app.evaluate(
    (_electron, data) => {
      globalThis.fetch = (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.hostname === 'readme.invalid')
          return Promise.resolve(
            new Response(url.searchParams.get('t') === 'caps' ? data.caps : data.releases, {
              headers: { 'Content-Type': 'application/xml' },
            }),
          );
        if (url.hostname !== 'api.themoviedb.org') return Promise.reject(new Error('offline'));
        const body =
          url.pathname === '/3/search/movie'
            ? data.search
            : url.pathname === '/3/search/tv'
              ? data.tv
              : url.pathname === '/3/movie/10331'
                ? data.details
                : null;
        return Promise.resolve(Response.json(body, { status: body ? 200 : 404 }));
      };
    },
    { ...fixtures, releases, caps },
  );
  const shot = async (name) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, `${name}.png`) });
  };

  await page.evaluate(
    async (dir) => {
      await globalThis.adrenaline.settings.update({ onboardingDone: true, theme: 'dark', downloadDir: dir });
      await globalThis.adrenaline.settings.setSecret({ name: 'tmdb.token', value: 'readme-token' });
      await globalThis.adrenaline.sources.addCustom({
        name: 'Public Domain Archive',
        endpoint: 'https://readme.invalid/torznab',
        apiKey: null,
      });
    },
    join(userData, 'Videos', 'Adrenaline'),
  );
  await page.reload();
  await page.getByTestId('screen-home').waitFor();

  await page.getByRole('searchbox').fill('Night of the Living Dead');
  await page.getByRole('searchbox').press('Enter');
  await page.getByRole('link', { name: /1968/ }).first().waitFor();
  await shot('catalog');

  await page.getByRole('link', { name: /1968/ }).first().click();
  await page.getByTestId('screen-title').waitFor();
  await shot('details');

  await page.getByRole('button', { name: 'Find releases' }).click();
  await page.getByRole('row').filter({ hasText: 'CLASSIC' }).waitFor();
  await shot('releases');

  await page.getByRole('row').filter({ hasText: 'CLASSIC' }).press('Enter');
  await page.getByTestId('download-start').waitFor();
  await page.getByTestId('download-sub-enabled').click();
  await shot('download-setup');

  // The download list: one finished movie, two in progress at a lower speed.
  await page.getByTestId('download-start').click();
  await page.getByTestId('screen-job').waitFor();
  await page.waitForTimeout(16_000);
  await page.evaluate(async () => {
    await globalThis.adrenaline.settings.update({ downloadLimitKBps: 4096 });
    await globalThis.adrenaline.dev.addTestDownload({ name: 'Metropolis' });
    await globalThis.adrenaline.dev.addTestDownload({ name: 'Nosferatu' });
  });
  await page
    .getByRole('navigation')
    .getByRole('link', { name: /Downloads/ })
    .click();
  await page.waitForTimeout(5_000);
  await shot('downloads');

  await page.getByRole('link', { name: 'Night of the Living Dead', exact: true }).click();
  await page.getByTestId('screen-job').waitFor();
  await shot('job-details');

  await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
  await shot('settings');
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: join(out, 'failure.png') });
  throw error;
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
