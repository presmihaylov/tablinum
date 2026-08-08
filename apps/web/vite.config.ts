import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The shared package is aliased to its source so `pnpm dev` works before it is built.
const sharedSrc = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

const API_TARGET = process.env['GITDOCS_API_URL'] ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@gitdocs/shared': sharedSrc,
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/_assets': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/_assets': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
