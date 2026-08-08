import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Real git processes and real temp repos: give each file room and keep them isolated.
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
