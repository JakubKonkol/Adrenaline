import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Manual TV demo server (scripts/dev/tv-demo.test.ts); not part of `npm test`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../src/shared') } },
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: [
      'scripts/dev/tv-demo.test.ts',
      'scripts/dev/tv-deploy.test.ts',
      'scripts/dev/tizen-deploy.test.ts',
    ],
    environment: 'node',
    testTimeout: 24 * 60 * 60_000,
  },
});
