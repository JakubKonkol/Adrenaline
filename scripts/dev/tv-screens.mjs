// Screenshots of the TV app driven with the remote keys (manual check, not part of `npm test`).
// Needs: the demo server (scripts/dev/tv-demo.test.ts) and `npm run dev:tv`.
//   node scripts/dev/tv-screens.mjs <out-dir> [images-dir]   (CHROME_PATH: use another Chromium build)
// images-dir: optional folder with demo-poster-*/demo-backdrop-* JPEGs served instead of image.tmdb.org.
/* global document -- page.evaluate() callbacks run in the browser */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'tv-screens';
const images = process.argv[3];
const url = process.env.TV_URL ?? 'http://localhost:5174/?server=127.0.0.1:18790';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.route('https://image.tmdb.org/**', (route) => {
  const file = images && join(images, basename(new URL(route.request().url()).pathname));
  return file && existsSync(file)
    ? route.fulfill({ body: readFileSync(file), contentType: 'image/jpeg' })
    : route.fulfill({ status: 404 });
});

const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(
    'saved',
    name,
    '— focused:',
    await page.evaluate(() => document.activeElement?.textContent?.slice(0, 60)),
  );
};
const press = async (key, times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await shot('01-connect');
await press('Enter'); // focus is on "Connect" (address prefilled)
await page.waitForTimeout(400);
await shot('02-pairing');
await page.waitForSelector('[data-testid="tab-discover"]', { timeout: 15_000 });
await page.waitForTimeout(1200);
await shot('03-discover');
await press('ArrowDown', 2);
await shot('04-discover-row');
await press('ArrowRight', 2);
await press('Enter');
await page.waitForTimeout(800);
await shot('05-details-movie');
await press('Enter'); // Download / Play
await page.waitForTimeout(2500);
await shot('06-releases');
await press('Enter');
await shot('07-confirm');
await press('Enter'); // start download → Library
await page.waitForTimeout(1500);
await shot('08-library');
await press('ArrowDown'); // "Downloading on your PC"
await shot('09-library-downloading');
await press('ArrowDown'); // Movies
await shot('10-library-movies');
await press('Enter');
await page.waitForTimeout(3000);
await shot('11-player');
await press('ArrowUp'); // subtitle menu
await shot('12-player-subtitles');
await press('Escape');
await press('Escape'); // leave the player
await page.waitForTimeout(800);
await press('ArrowDown'); // shows row
await press('Enter');
await page.waitForTimeout(800);
await shot('13-library-show');
await press('Escape');
await page.waitForTimeout(500);
// Discover → search.
await press('ArrowUp', 4);
await press('ArrowLeft');
await page.waitForTimeout(800);
await press('ArrowDown');
await press('Enter'); // opens the keyboard (input focus)
await page.keyboard.type('orbit');
await press('Enter'); // closes the keyboard
await page.waitForTimeout(1500);
await shot('14-search');
await press('ArrowDown');
await press('Enter');
await page.waitForTimeout(1200);
await shot('15-details-show');
await press('ArrowDown');
await shot('16-episodes');
await press('Escape');
await page.waitForTimeout(500);
await press('ArrowUp', 4);
await press('ArrowRight', 3);
await press('Enter');
await page.waitForTimeout(500);
await shot('17-settings');
await browser.close();
