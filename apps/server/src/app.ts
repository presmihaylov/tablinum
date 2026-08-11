import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  ASSETS_DIR,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_SLUG,
} from '@tablinum/shared';
import { registerAuthHook, routedPathname } from './auth.js';
import { rememberContext, type RouteContext } from './context.js';
import { CursorDesk } from './cursors.js';
import type { ServerDeps } from './deps.js';
import { registerErrorHandler } from './errors.js';
import { LiveHub, registerLiveRoutes } from './live.js';
import { createMentionNotifier } from './mentions.js';
import { privateSpacesOf } from './private.js';
import { createSlackApi, type SlackApi } from './slack.js';
import { createWebhookSender, type WebhookSender } from './webhooks.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerAssetRoutes, MAX_ASSET_BYTES } from './routes/assets.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCommentRoutes } from './routes/comments.js';
import { registerDatabaseRoutes } from './routes/databases.js';
import { registerEmojiRoutes } from './routes/emoji.js';
import { registerFavoriteRoutes } from './routes/favorites.js';
import { registerGitRoutes } from './routes/git.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerInviteRoutes } from './routes/invites.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSpaceRoutes } from './routes/spaces.js';
import { registerTreeRoutes } from './routes/tree.js';
import { registerUserRoutes } from './routes/users.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { VERSION } from './version.js';
import { Wiring } from './wiring.js';
import { WorkspaceRegistry, registerWorkspaceHook, type WorkspaceParts } from './workspaces.js';

/** Markdown bodies can be long; multipart uploads use their own, larger limit. */
const JSON_BODY_LIMIT = 8 * 1024 * 1024;

/** Where the web build puts its hashed bundles, relative to the site root. */
const WEB_ASSETS_DIR = 'assets';

/**
 * What the app shell may load. `style-src 'unsafe-inline'` stays because the editor writes
 * style attributes; scripts get no such escape, so the theme boot lives in a file. The https
 * sources carry remote images in markdown and the video players in editor/embeds.ts.
 */
const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  'frame-src https:',
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HERE = dirname(fileURLToPath(import.meta.url));

/** `apps/web/dist`, resolved from either `apps/server/src` or `apps/server/dist`. */
function defaultWebDist(): string {
  return resolve(HERE, '../../web/dist');
}

/** An injected transport wins, so tests never reach Slack. */
function resolveSlack(deps: ServerDeps, log: FastifyBaseLogger): SlackApi | null {
  if (deps.slack !== undefined) return deps.slack;
  const token = deps.config.slackBotToken;
  return token === null ? null : createSlackApi({ token, log });
}

/** Null turns agent webhooks off: without a secret nothing may be signed, so nothing is sent. */
function resolveWebhooks(deps: ServerDeps, log: FastifyBaseLogger): WebhookSender | null {
  if (deps.webhooks !== undefined) return deps.webhooks;
  const secret = deps.config.webhookSecret;
  return secret === null ? null : createWebhookSender({ secret, log });
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

  // Before any route: Fastify freezes a route's hook chain when the route is added. Only the
  // shell gets a policy, so the stricter one an attachment sets for itself survives.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) reply.header('content-security-policy', HTML_CSP);
    return payload;
  });

  await app.register(fastifyCookie, { secret: deps.config.sessionSecret });
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_ASSET_BYTES, files: 1, fields: 8, fieldSize: 4096 },
  });
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  // The hook must exist before any route is added: Fastify freezes a route's hook chain
  // at registration time, so a route added first would never be protected.
  registerAuthHook(app, deps);

  const live = new LiveHub(app.log);
  // A room starts from the file on disk, so a tab that joins late gets the same bytes an
  // agent would read. Steps are then layered on top of it.
  live.useDocs(async (path) => {
    try {
      const page = await deps.store.getPageByPath(path);
      return page === null ? null : { markdown: page.markdown, title: page.title, rev: page.rev };
    } catch {
      // A page that is not there yet cannot be streamed; the tab falls back to plain saves.
      return null;
    }
  });
  live.useSpaces(() => privateSpacesOf(deps.store));
  live.start();

  // The configured content directory is the default workspace. An install that predates
  // workspaces adopts its people, agents and invites into it here, once.
  const defaultRecord = deps.accounts.ensureWorkspaceForDir(
    deps.store.contentDir,
    DEFAULT_WORKSPACE_NAME,
    DEFAULT_WORKSPACE_SLUG,
  );
  const defaultParts: WorkspaceParts = {
    record: defaultRecord,
    store: deps.store,
    git: deps.git,
    search: deps.search,
    wiring: new Wiring(deps, app.log, live),
    live,
  };
  const workspaces = new WorkspaceRegistry(deps, app.log, defaultParts);
  registerWorkspaceHook(app, workspaces);

  app.addHook('onClose', async () => {
    live.closeAll();
    await workspaces.closeAll();
  });

  const slack = resolveSlack(deps, app.log);
  const webhooks = resolveWebhooks(deps, app.log);
  const ctx: RouteContext = {
    deps,
    workspaces,
    wiring: defaultParts.wiring,
    live,
    cursors: new CursorDesk(),
    slack,
    mentions: createMentionNotifier({
      accounts: deps.accounts,
      slack,
      webhooks,
      log: app.log,
      publicUrl: deps.config.publicUrl,
    }),
    log: app.log,
    version: deps.version ?? VERSION,
  };
  rememberContext(app, ctx);

  registerLiveRoutes(app, ctx);
  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerWorkspaceRoutes(app, ctx);
  registerInviteRoutes(app, ctx);
  registerAgentRoutes(app, ctx);
  registerEmojiRoutes(app, ctx);
  registerSpaceRoutes(app, ctx);
  registerTreeRoutes(app, ctx);
  registerPageRoutes(app, ctx);
  registerCommentRoutes(app, ctx);
  registerFavoriteRoutes(app, ctx);
  registerDatabaseRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerGitRoutes(app, ctx);
  registerAssetRoutes(app, ctx);
  // Last, because its tools reach the routes above through app.inject().
  registerMcpRoutes(app);

  // Attachments are per workspace, so they cannot be one fixed static mount. `serve: false`
  // registers no route and only adds reply.sendFile(), which the asset route aims at the
  // directory of whichever workspace the caller is in.
  mkdirSync(join(deps.store.contentDir, ASSETS_DIR), { recursive: true });
  await app.register(fastifyStatic, {
    root: join(deps.store.contentDir, ASSETS_DIR),
    serve: false,
    decorateReply: true,
  });

  const webDist = resolveWebDist(deps);
  if (webDist !== null) {
    // wildcard:false registers one route per built file, leaving unknown paths to the
    // not-found handler below, which is what makes the SPA fallback possible.
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
      decorateReply: false,
      index: ['index.html'],
      list: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    // Decoded, or `/%61pi/v1/nope` would be handed the SPA shell instead of a JSON 404.
    const pathname = routedPathname(request.url);
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const isAsset = pathname === `/${ASSETS_DIR}` || pathname.startsWith(`/${ASSETS_DIR}/`);
    // The built bundles live under /assets/. Serving index.html for a missing one hands the
    // browser HTML where it expects JavaScript, and the real error becomes a syntax error.
    const isBundle = pathname.startsWith(`/${WEB_ASSETS_DIR}/`);
    const wantsDocument = request.method === 'GET' || request.method === 'HEAD';

    if (webDist !== null && wantsDocument && !isApi && !isAsset && !isBundle) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html', webDist);
    }

    return reply.status(404).type('application/json').send({
      error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${pathname}` },
    });
  });

  await app.ready();
  return app;
}

export { VERSION };
