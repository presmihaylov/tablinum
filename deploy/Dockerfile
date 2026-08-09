# syntax=docker/dockerfile:1.7
#
# tablinum production image.
#   build context = the repository root
#   docker build -f deploy/Dockerfile -t tablinum:latest .

# ---------------------------------------------------------------------------
# base - node + a pinned pnpm, shared by the build and the runtime stage
# ---------------------------------------------------------------------------
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.9.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# build - installs every dependency, compiles every workspace package and the
#         web UI, then prunes itself down to a production tree.
#         better-sqlite3 compiles here, so python3/make/g++ live in THIS stage
#         only and never reach the runtime image.
# ---------------------------------------------------------------------------
FROM base AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Manifests first: this layer is cached until a package.json actually changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY packages/shared/package.json   packages/shared/
COPY packages/core/package.json     packages/core/
COPY packages/git-sync/package.json packages/git-sync/
COPY packages/search/package.json   packages/search/
COPY packages/mcp/package.json      packages/mcp/
COPY apps/server/package.json       apps/server/
COPY apps/web/package.json          apps/web/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
    else pnpm install --no-frozen-lockfile; fi

COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps

# Compiles packages/*/dist, apps/server/dist and apps/web/dist.
RUN pnpm build

# Drop dev dependencies. The native better-sqlite3 build stays because it is a
# production dependency and the toolchain is still available in this stage.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile --prod; \
    else pnpm install --no-frozen-lockfile --prod; fi

# Keep only what the server needs at runtime: production node_modules, the
# compiled dist output and the static web bundle.
RUN rm -rf apps/web/node_modules apps/web/public apps/web/index.html apps/web/vite.config.* \
 && find packages apps -maxdepth 2 -type d \( -name src -o -name test -o -name tests \) -prune -exec rm -rf {} + \
 && find . -name '*.tsbuildinfo' -delete \
 && find packages apps -name '*.js.map' -delete \
 && find packages apps -name '*.d.ts.map' -delete

# ---------------------------------------------------------------------------
# runtime - slim, non-root, git-capable
# ---------------------------------------------------------------------------
FROM base AS runtime

# git drives the whole storage model; openssh-client is needed for SSH remotes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="tablinum" \
      org.opencontainers.image.description="Self-hosted docs app backed by a git repo of markdown files." \
      org.opencontainers.image.source="https://github.com/presmihaylov/tablinum" \
      org.opencontainers.image.licenses="MIT"

# HOME is what git --global writes into; pin it so it cannot depend on how the
# container was started.
ENV HOME=/home/node \
    NODE_ENV=production \
    TABLINUM_CONTENT_DIR=/data/content \
    TABLINUM_SEARCH_DB=/data/search.db \
    TABLINUM_WEB_DIR=/app/apps/web/dist \
    TABLINUM_PORT=4000

# The named volume inherits this ownership the first time it is created.
RUN mkdir -p /data/content && chown -R node:node /data

COPY --from=build --chown=node:node /app /app
COPY deploy/docker-entrypoint.sh /usr/local/bin/tablinum-entrypoint
RUN chmod 0755 /usr/local/bin/tablinum-entrypoint

USER node
WORKDIR /app
VOLUME ["/data"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "-e", "const p=process.env.TABLINUM_PORT||4000;fetch('http://127.0.0.1:'+p+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/tablinum-entrypoint"]
# Matches the "start" script of @tablinum/server.
CMD ["node", "/app/apps/server/dist/server.js"]
