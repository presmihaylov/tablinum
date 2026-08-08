import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against the shared package sources so `pnpm test` never depends on a prior build.
const sharedEntry = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@gitdocs/shared': sharedEntry,
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
