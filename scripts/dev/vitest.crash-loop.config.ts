import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Manual NFR04 check (etap 6.4); not part of `npm test`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../src/shared') } },
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: ['scripts/dev/crash-loop.test.ts'],
    environment: 'node',
    testTimeout: 30 * 60_000,
  },
});
