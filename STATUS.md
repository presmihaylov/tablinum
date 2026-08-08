# gitdocs — integration status

Last verified: 2026-08-08, Node 22.22.3, pnpm 10.9.0, macOS (darwin 23.6.0).

gitdocs is a standalone, self-hosted docs app. Every page is a markdown file with YAML
frontmatter in a git repo. Humans edit through the web block editor; agents edit through the
REST API, the MCP server, or the files themselves.

---

## Gate results

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm -r typecheck` | PASS — 7 projects, strict + `noUncheckedIndexedAccess`, 0 errors |
| Build | `pnpm -r build` | PASS — 7 dist outputs, Vite bundle 1,079 kB (352 kB gzip) |
| Test | `pnpm -r test` | PASS — 47 files, **982 tests**, 0 failures |

Per-package tests: shared 157, core 183, git-sync 64, search 89, mcp 108, server 69, web 312.

---

## What works end to end (verified against a live server)

The demo content was seeded into a temp directory, the built server ran on port 4177 with a
real bearer token and a real password, and every line below is a captured command output.

### REST API

- `GET /health` → `{"ok":true,"version":"0.1.0","contentDir":"..."}`.
- Auth is enforced. No token and a wrong token both give
  `UNAUTHORIZED: Missing or invalid credentials`. `POST /auth/login` with the password sets a
  session cookie, and that cookie then authorises `GET /spaces`. A wrong password gives
  `UNAUTHORIZED: Invalid password`.
- `GET /tree` returns every space with its nested tree, icons and sibling order.
- `POST /pages` → 201 with the created page, and the file appears on disk with the frontmatter
  keys in contract order (`id, title, icon, tags, order, created, updated, props`).
- `GET /pages/:id` and `GET /pages?path=` return the same page.
- `PATCH /pages/:id` updates markdown and props and bumps `updated`.
- `PATCH /pages/:id` with `path` moves the page. The id does not change.
- A deep create fills in the missing ancestors and indexes them:
  `POST /pages {"path":"docs/handbook/hiring/interviews"}` made `docs/handbook` and
  `docs/handbook/hiring`, and `GET /search?q=handbook` found all three at once.
- Creating a child under a leaf promotes it from `foo.md` to `foo/index.md`. Moving the last
  child away demotes it back.
- `DELETE /pages/:id` → `{"deleted":["engineering/e2e-page"]}`. Deleting a parent without
  `?recursive=true` → HTTP 409 `CONFLICT`.
- `GET /search?q=capybara` returns the hit with a `<mark>`-highlighted snippet.
- `GET /views?dir=engineering/runbooks` → `columns: owner, priority, rehearsed, status` and one
  row per child page.
- `GET /pages/:id/backlinks` resolves wikilinks in reverse (3 pages point at the deploy runbook).
- `GET /pages/:id/history` returns real commits, and `GET /pages/:id/revisions/:sha` returns the
  markdown and frontmatter as they were at that sha.
- `GET /git/status` → `branch=main ahead=0 behind=0 dirty=0 last=Move docs/e2e-page to ...`.
- `POST /assets` (multipart) stores the file under `_assets/<pageId>/` and returns its url. A
  `GET` on that url returns HTTP 200 `image/gif`.
- An unknown `/api/v1/*` path returns 404 with a token and 401 without one.

### Git

Auto-commit is real. The content repo after the walkthrough:

```
683e9fa Delete engineering/e2e-page
4f8ccd8 docs: update 1 page(s)
3777b30 Add attachment tiny.gif to engineering/e2e-page
444bf82 Move docs/e2e-page to engineering/e2e-page
a633add docs: update 4 page(s)
467e198 chore: normalize page line endings
```

The working tree is clean after every operation and after shutdown.

### Agents editing files directly

A bare `.md` file written straight into the git repo (no frontmatter, no API call) is picked up
by the content watcher, repaired with a generated id and a title from its first H1, indexed for
search, and committed. Its id then stays the same across server restarts.

### Web UI

- `GET /` returns the built `index.html` (973 B), which references the hashed JS and CSS assets.
- Any non-`/api` GET falls back to `index.html`, so deep links such as
  `/p/docs/getting-started` return 200.
- Driven in a real browser earlier in the project: the login screen accepts the password, the app
  renders the sidebar tree, space switcher, search, the block editor, the properties panel, tags,
  backlinks and history, and typing autosaves to disk and to git. This browser pass was **not**
  repeated in the final verification run; the two HTTP checks above were.

### MCP server

`packages/mcp/dist/cli.js` was spawned over stdio by a real MCP `Client` against the live API
earlier in the project: `tools/list` returned all 11 tools, `gitdocs_list_tree` rendered the
outline, `gitdocs_create_page` created a page that REST search then found, and a missing path
returned a readable tool error. The final verification run covered the MCP package by its 108
unit tests only, not by a live stdio session.

### Lifecycle

`SIGTERM` shut the server down in **0.15 s**: the watcher closed, Fastify closed, the pending
commit was flushed, the database closed, and the process exited. No hang, no stray process, no
dirty repo.

### Dev script

`bash scripts/dev.sh` generates and persists a dev token and session secret, builds the
libraries, seeds `.data/content` when empty, prints a banner, and runs the API and Vite together.
Both `scripts/dev.sh` and `scripts/seed.ts` now also accept the `--` that `pnpm run` forwards, so
`pnpm seed -- --dir /tmp/x` works as documented.

---

## Partial

- **Markdown round trip.** The editor reproduces the source bytes for **175** corpus cases,
  including GFM tables with a short, wide or pipe-less delimiter row, lower-case callout
  keywords, indented setext underlines, empty task items, and fences that hold a bare triple
  backtick. **15** constructs still normalise on save and are pinned in
  `apps/web/test/editor/roundtrip.test.ts` under `KNOWN_CHURN`: nested list indent width,
  trailing spaces on a list item or a table row, indented and unclosed fences, padded inline
  code, lazy and space-less blockquote markers, single-quoted and parenthesised image titles,
  and a document that mixes CRLF with LF. Re-saving is idempotent, so a page never drifts
  further after the first save.
- **Web bundle size.** 1.08 MB raw / 352 kB gzipped in one chunk. It loads fine, but there is no
  code splitting; the editor and highlight.js dominate.
- **Docker image.** `deploy/Dockerfile` and `docker-compose.yml` are complete and their shell and
  YAML parse, but no Docker daemon was available here, so the image has never been built.
- **Git remote sync.** `POST /git/pull` and `POST /git/push` are covered by the git-sync tests
  against a bare temp remote. The live walkthrough used a local-only repo, so no real remote was
  exercised.

## Known gaps

- **The server route tests run against a test double, not the core store.**
  `apps/server/test/support/fs-store.ts` re-implements the `ContentStore` contract in the test
  tree. It now mirrors the real store on deep creates (it fills in missing ancestors), but any
  other divergence between the double and `packages/core` is invisible to the route suite. The
  fix is to export a `CoreStoreAdapter` from the server and run the suite against the real store;
  that is a larger change and is deliberately not in this pass.
- **`GITDOCS_WEB_DIR` and `GITDOCS_SEARCH_DB` are not read by `server.ts`.** The deploy image sets
  both. They are harmless today: `defaultWebDist()` resolves `apps/web/dist` relative to the
  server bundle, and `defaultDbPath(contentDir)` puts `search.db` beside the content dir, which
  is exactly `/data/search.db` in the image. If the layout changes, `server.ts` must read them.
- **A repair rewrites the file.** A markdown file that is missing any required frontmatter field
  is rewritten once on the next scan to complete it. This keeps page ids stable, but it means a
  partially hand-written file is not preserved byte for byte. Complete files are never touched.
- **A new space's home page takes a titleized slug.** `createSpace('ops', 'Operations')` followed
  by a page under it generates `ops/index.md` titled "Ops", not "Operations". The space name in
  `_space.yml` is correct; only the home page title differs.
- **The search index is not encrypted or access-scoped.** Every authenticated caller can search
  every space. There are no per-user permissions anywhere: auth is all-or-nothing.
- **No rate limiting** on any endpoint, including `POST /auth/login`.

## Behaviour changes worth knowing

- **New space slugs must be lower case and URL-safe** (`/^[a-z0-9][a-z0-9-]*$/`).
  `createSpace('Ops Team', ...)` now fails with VALIDATION. A directory that a human created by
  hand keeps working: `listSpaces()` and `getSpace()` still accept any single-segment name, so an
  existing `My Docs/` directory is read, listed and served.
- **Dot-prefixed path segments are refused.** The scanner skips `.git` and friends, so a page at
  `docs/.hidden` would have been written and then never indexed.

---

## How to run it

### Install and verify

```bash
cd /Users/pmihaylov/prg/repos/gitdocs
pnpm install
pnpm -r typecheck
pnpm -r build
pnpm -r test
```

### Development

```bash
pnpm dev                 # builds, seeds .data/content, runs the API + Vite, prints a token
pnpm dev -- --port 4100  # another API port
pnpm dev -- --reset      # throw away the generated dev token and secret
```

The banner prints the web URL, the login password and the API token.

### Production-style run against your own content

```bash
pnpm -r build

export GITDOCS_CONTENT_DIR=/absolute/path/to/content
export GITDOCS_PORT=4000
export GITDOCS_API_TOKENS=your-token-here
export GITDOCS_PASSWORD=your-web-password
export GITDOCS_SESSION_SECRET=$(openssl rand -hex 32)
export GITDOCS_AUTOCOMMIT_MS=5000
export GITDOCS_AUTOPULL_MS=60000        # 0 turns the periodic pull off

node apps/server/dist/server.js
```

Open `http://localhost:4000`. The built web UI is served from the same port.

### Seed demo content somewhere else

```bash
pnpm seed -- --dir /tmp/gitdocs-content
```

### Call the API

```bash
TOKEN=your-token-here
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/tree
curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/search?q=deploy"
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"path":"docs/new-page","title":"New page","markdown":"# New page\n"}' \
  http://localhost:4000/api/v1/pages
```

### Register the MCP server with Claude Code

```bash
claude mcp add gitdocs --scope project \
  --env GITDOCS_URL=http://127.0.0.1:4000 \
  --env GITDOCS_TOKEN=your-token-here \
  -- node /Users/pmihaylov/prg/repos/gitdocs/packages/mcp/dist/cli.js
```

### Docker

```bash
pnpm docker:build
cd deploy && cp .env.example .env && $EDITOR .env && docker compose up -d
```

See `deploy/README.md` for remotes, TLS, backup and troubleshooting.
