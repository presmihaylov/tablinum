import { createReadStream } from 'node:fs';
import { cp } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

// The shared package is aliased to its source so `pnpm dev` works before it is built.
const sharedSrc = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

const API_TARGET = process.env['TABLINUM_API_URL'] ?? 'http://localhost:4000';

const EXCALIDRAW_FONTS = fileURLToPath(
  new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url),
);
const EXCALIDRAW_PREFIX = '/assets/excalidraw/fonts/';

/**
 * Excalidraw fetches its fonts from esm.sh unless `window.EXCALIDRAW_ASSET_PATH` points
 * somewhere else. Serving a copy from the app's own origin keeps the editor off any CDN,
 * which a Content-Security-Policy would otherwise have to allow.
 */
function excalidrawFonts(): Plugin {
  let outDir = '';
  let building = false;

  return {
    name: 'tablinum-excalidraw-fonts',

    configResolved(config) {
      building = config.command === 'build';
      outDir = resolve(config.root, config.build.outDir);
    },

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? '';
        if (!url.startsWith(EXCALIDRAW_PREFIX)) return next();
        const rel = normalize(url.slice(EXCALIDRAW_PREFIX.length).split('?')[0] ?? '');
        const file = join(EXCALIDRAW_FONTS, rel);
        if (!file.startsWith(EXCALIDRAW_FONTS)) return next();
        response.setHeader('content-type', 'font/woff2');
        createReadStream(file).on('error', next).pipe(response);
      });
    },

    async closeBundle() {
      if (!building) return;
      await cp(EXCALIDRAW_FONTS, join(outDir, EXCALIDRAW_PREFIX.slice(1)), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), excalidrawFonts()],
  resolve: {
    alias: {
      '@tablinum/shared': sharedSrc,
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // ws: the live channel upgrades under the same prefix.
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
      '/_assets': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      // ws: the live channel upgrades under the same prefix.
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
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
