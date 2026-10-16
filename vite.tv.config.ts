import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };

/**
 * The PC address is only known at runtime: any http(s) host for the API and media, images from TMDB. `file:` is listed
 * next to 'self' because the TVs load the page from local files. Build only: the dev server needs inline scripts.
 */
const CSP = [
  "default-src 'self' file:",
  "script-src 'self' file:",
  "style-src 'self' file: 'unsafe-inline'",
  "font-src 'self' file: data:",
  "img-src 'self' file: data: https://image.tmdb.org",
  "connect-src 'self' file: http: https:",
  'media-src http: https: blob:',
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * TV apps load the UI from local files (Tizen widget, Android assets). Chromium refuses ES module scripts and
 * `crossorigin` assets from file:// (origin "null"), so the bundle is one classic IIFE script without those attributes.
 */
function classicScript(): Plugin {
  return {
    name: 'adrenaline-tv-classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/\s+type="module"/g, ' defer')
        .replace(/\s+crossorigin(="[^"]*")?/g, '')
        .replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        );
    },
  };
}

/** Web client for Samsung Tizen and Android TV (D-81). Output: out/tv (packed by scripts/tv/*). */
export default defineConfig({
  root: resolve('src/tv'),
  base: './',
  resolve: { alias: { '@shared': resolve('src/shared') } },
  define: { __TV_VERSION__: JSON.stringify(version) },
  plugins: [react(), classicScript()],
  server: { port: 5174, strictPort: true },
  build: {
    outDir: resolve('out/tv'),
    emptyOutDir: true,
    // Tizen 5.5 (2020) runs Chromium 69; Tizen 6.0 (2021) Chromium 76. Android TV WebView is newer.
    target: ['chrome69'],
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'app.js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
