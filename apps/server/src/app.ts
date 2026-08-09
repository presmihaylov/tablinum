import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { ASSETS_DIR, OPEN_MODE_WARNING } from '@gitdocs/shared';
import { normalizePathname, registerAuthHook } from './auth.js';
import { rememberContext, type RouteContext } from './context.js';
import type { ServerDeps } from './deps.js';
import { registerErrorHandler } from './errors.js';
import { LiveHub, registerLiveRoutes } from './live.js';
import { registerAssetRoutes, MAX_ASSET_BYTES } from './routes/assets.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerGitRoutes } from './routes/git.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSpaceRoutes } from './routes/spaces.js';
import { registerTreeRoutes } from './routes/tree.js';
import { VERSION } from './version.js';
import { Wiring } from './wiring.js';

/** Markdown bodies can be long; multipart uploads use their own, larger limit. */
const JSON_BODY_LIMIT = 8 * 1024 * 1024;

/** Where the web build puts its hashed bundles, relative to the site root. */
const WEB_ASSETS_DIR = 'assets';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `apps/web/dist`, resolved from either `apps/server/src` or `apps/server/dist`. */
function defaultWebDist(): string {
  return resolve(HERE, '../../web/dist');
}

function resolveWebDist(deps: ServerDeps): string | null {
  if (deps.webDistDir === null) return null;
  const candidate = deps.webDistDir ?? defaultWebDist();
  return existsSync(join(candidate, 'index.html')) ? candidate : null;
}

/**
 * Build a fully wired Fastify instance. Nothing here listens on a port and nothing reads
 * process.env, so tests can run the whole API over a temporary content directory.
 */
export async function buildApp(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? true,
    trustProxy: deps.trustProxy ?? false,
    bodyLimit: JSON_BODY_LIMIT,
  });

  registerErrorHandler(app);

  await app.register(fastifyCookie, { secret: deps.config.sessionSecret });
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_ASSET_BYTES, files: 1, fields: 8, fieldSize: 4096 },
  });
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  if (deps.config.openMode) app.log.warn(OPEN_MODE_WARNING);

  // The hook must exist before any route is added: Fastify freezes a route's hook chain
  // at registration time, so a route added first would never be protected.
  registerAuthHook(app, deps.config);

  const live = new LiveHub(app.log);
  live.start();
  app.addHook('onClose', async () => {
    live.closeAll();
  });

  const ctx: RouteContext = {
    deps,
    wiring: new Wiring(deps, app.log, live),
    live,
    version: deps.version ?? VERSION,
  };
  rememberContext(app, ctx);

  registerLiveRoutes(app, ctx);
  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerSpaceRoutes(app, ctx);
  registerTreeRoutes(app, ctx);
  registerPageRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerGitRoutes(app, ctx);
  registerAssetRoutes(app, ctx);

  const assetsRoot = join(deps.store.contentDir, ASSETS_DIR);
  mkdirSync(assetsRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: assetsRoot,
    prefix: `/${ASSETS_DIR}/`,
    decorateReply: false,
    index: false,
    list: false,
  });

  const webDist = resolveWebDist(deps);
  if (webDist !== null) {
    // wildcard:false registers one route per built file, leaving unknown paths to the
    // not-found handler below, which is what makes the SPA fallback possible.
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
      index: ['index.html'],
      list: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = normalizePathname(request.url);
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const isAsset = pathname === `/${ASSETS_DIR}` || pathname.startsWith(`/${ASSETS_DIR}/`);
    // The built bundles live under /assets/. Serving index.html for a missing one hands the
    // browser HTML where it expects JavaScript, and the real error becomes a syntax error.
    const isBundle = pathname.startsWith(`/${WEB_ASSETS_DIR}/`);
    const wantsDocument = request.method === 'GET' || request.method === 'HEAD';

    if (webDist !== null && wantsDocument && !isApi && !isAsset && !isBundle) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }

    return reply.status(404).type('application/json').send({
      error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${pathname}` },
    });
  });

  await app.ready();
  return app;
}

export { VERSION };
