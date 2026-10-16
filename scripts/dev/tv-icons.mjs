// Renders the TV app icon and banner (tv/assets) from the brand SVGs. Manual: node scripts/dev/tv-icons.mjs
// (CHROME_PATH: another Chromium build than Playwright's default).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const mark = readFileSync('src/renderer/assets/brand/adrenaline-mark-on-dark.svg', 'utf8');
const logo = readFileSync('src/renderer/assets/brand/adrenaline-logo-on-dark.svg', 'utf8');
const b64 = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
const render = async (w, h, html, out) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<html><body style="margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 20%,#23262e 0%,#0b0d10 70%)">${html}</body></html>`,
  );
  await page.waitForTimeout(100);
  await page.screenshot({ path: out });
};
// Tizen launcher icon (512×512), Android TV launcher (512×512 → mipmaps) and banner (320×180 xhdpi, 640×360 source).
await render(512, 512, `<img src="${b64(mark)}" style="width:300px;height:300px">`, 'tv/assets/icon-512.png');
await render(640, 360, `<img src="${b64(logo)}" style="width:520px">`, 'tv/assets/banner-640x360.png');
await browser.close();
