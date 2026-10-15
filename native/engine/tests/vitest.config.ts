import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration test of the real engine binary (ADRENALINE_ENGINE_PATH). Not part of `npm test`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../../src/shared') } },
  test: {
    root: resolve(import.meta.dirname, '../../..'),
    include: ['native/engine/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
