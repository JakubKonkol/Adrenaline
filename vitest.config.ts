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
    ],
  },
});
