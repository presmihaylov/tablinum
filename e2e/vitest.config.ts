import { defineConfig } from 'vitest/config';

// One server and one content directory back the run, so the specs go one at a time, in one worker.
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['**/*.spec.ts'],
    globalSetup: ['./harness/global-setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // A flaky test gets one more go on CI only, so a local run shows every flake.
    retry: process.env.CI === undefined ? 0 : 1,
    allowOnly: process.env.CI === undefined,
    expect: { poll: { timeout: 10_000, interval: 100 } },
    reporters: ['default'],
  },
});
