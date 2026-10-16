import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = { '@shared': resolve('src/shared') };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'src/preload/**/*.test.ts',
            'scripts/**/*.test.{ts,mjs}',
          ],
          // Manual long-running checks (npm run crash-loop).
          exclude: ['scripts/dev/**', '**/node_modules/**'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        define: { __TV_VERSION__: JSON.stringify('test') },
        test: {
          name: 'tv',
          environment: 'happy-dom',
          include: ['src/tv/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
