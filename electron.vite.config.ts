import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { buildCsp } from './src/shared/security/csp';

const alias = { '@shared': resolve('src/shared') };
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };

/** Injects the CSP as a meta tag; main also sends it as a response header (01-architektura.md). */
function cspMetaPlugin(): Plugin {
  let dev = false;
  return {
    name: 'adrenaline-csp-meta',
    configResolved(config) {
      dev = config.command === 'serve';
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp({ dev }) },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
    // `app.getVersion()` returns Electron's version when the app runs unpackaged from out/ (dev, smoke test).
    define: { __ADRENALINE_VERSION__: JSON.stringify(version) },
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preloads must be CommonJS.
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias },
    plugins: [react(), cspMetaPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
  },
});
