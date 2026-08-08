# gitdocs — FROZEN CONTRACT

Every package builds against this document. It is frozen: do not change it without a coordinated
update across all packages. If code and this file disagree, this file wins.

gitdocs is a **standalone** self-hosted docs app. It has **no connection to Notion**: no import, no
API, no sync. It only borrows the *look and feel* of that style of block editor.

---

## MONOREPO LAYOUT (pnpm workspaces)

```
/Users/pmihaylov/prg/repos/gitdocs/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, README.md, .env.example
  packages/shared/    @gitdocs/shared   - types + zod schemas + config, zero deps beyond zod
  packages/core/      @gitdocs/core     - content store (fs, frontmatter, page tree, id index)
  packages/git-sync/  @gitdocs/git-sync - git engine
  packages/search/    @gitdocs/search   - sqlite FTS5 index
  packages/mcp/       @gitdocs/mcp      - MCP stdio server
  apps/server/        @gitdocs/server   - Fastify REST API
  apps/web/           @gitdocs/web      - React + Vite + TipTap
  deploy/                               - Dockerfile, docker-compose.yml, ops guide
```

## ON-DISK CONTENT FORMAT (source of truth for everything)

A content repo is a git repo. Default path: `${GITDOCS_CONTENT_DIR}`, fallback
`/Users/pmihaylov/prg/repos/gitdocs/.data/content`

Layout:

```
content/
  <space-slug>/
    _space.yml              # { name, icon, order }
    index.md                # the space home page
    getting-started.md      # a leaf page
    engineering/
      index.md              # the "engineering" page ITSELF
      deploy.md             # a child of "engineering"
```

RULES:

- A page is EITHER `<name>.md` (leaf) OR `<name>/index.md` (page that has children).
- `pagePath` = file path relative to `content/`, minus `.md`, minus trailing `/index`.
  e.g. `content/eng/runbooks/index.md` -> pagePath `eng/runbooks`
       `content/eng/deploy.md`         -> pagePath `eng/deploy`
- Promoting a leaf to a parent = move `foo.md` -> `foo/index.md`. Core does this automatically
  when a child is created under a leaf page. Removing the last child demotes it back.
- Attachments live in `content/_assets/<pageId>/<filename>`, referenced as
  `/_assets/<pageId>/<filename>`.

## FRONTMATTER

YAML, always present, always in this key order:

```yaml
---
id: pg_01J8XYZ...        # ULID-suffixed, stable, NEVER changes across renames/moves.
title: Deploy runbook    # required, string
icon: "🚀"               # optional, single emoji
tags: [ops, deploy]      # optional, string[]
order: 10                # optional, number; sibling sort. Missing = sort by title.
created: 2026-08-08T10:00:00.000Z   # ISO 8601 UTC
updated: 2026-08-08T10:00:00.000Z   # ISO 8601 UTC
props:                   # optional, Record<string, string|number|boolean|string[]|null>
  status: draft          # arbitrary user properties. THIS powers the table view.
  owner: pmihaylov
---
```

Body below is plain CommonMark + GFM (tables, task lists, strikethrough, autolinks).
Wikilinks `[[page-path]]` and `[[page-path|alias]]` are supported and resolved by core.

## SHARED TYPES

`packages/shared/src/types.ts` — authoritative, other packages import these:

```ts
export type PageId = string;            // "pg_" + ULID
export type PagePath = string;          // "eng/runbooks/deploy", no leading/trailing slash

export type PropValue = string | number | boolean | string[] | null;

export interface Frontmatter {
  id: PageId;
  title: string;
  icon?: string;
  tags?: string[];
  order?: number;
  created: string;      // ISO
  updated: string;      // ISO
  props?: Record<string, PropValue>;
}

export interface Page {
  id: PageId;
  path: PagePath;
  space: string;         // first path segment
  title: string;
  icon?: string;
  tags: string[];
  order?: number;
  created: string;
  updated: string;
  props: Record<string, PropValue>;
  markdown: string;      // body WITHOUT frontmatter
  filePath: string;      // absolute path on disk
  hasChildren: boolean;
}

export type PageSummary = Omit<Page, 'markdown'>;

export interface TreeNode {
  id: PageId;
  path: PagePath;
  title: string;
  icon?: string;
  order?: number;
  children: TreeNode[];
}

export interface Space { slug: string; name: string; icon?: string; order?: number; }

export interface SearchHit { id: PageId; path: PagePath; title: string; snippet: string; score: number; }

export interface Revision { sha: string; author: string; email: string; date: string; message: string; }

export interface GitStatus {
  branch: string; ahead: number; behind: number;
  dirtyFiles: string[]; remote: string | null; lastCommit: Revision | null;
}

export interface Backlink { id: PageId; path: PagePath; title: string; }
```

## REST API

`apps/server`, all under `/api/v1`, JSON in/out.

Auth: `Authorization: Bearer <token>`. Tokens come from env `GITDOCS_API_TOKENS` (comma-separated).
The web UI authenticates with a signed httpOnly session cookie set by `POST /api/v1/auth/login`
(password from env `GITDOCS_PASSWORD`). Both auth paths grant the same access.
If `GITDOCS_API_TOKENS` and `GITDOCS_PASSWORD` are both unset, run in OPEN mode (no auth) and log
a loud warning.

```
GET    /api/v1/health                          -> { ok: true, version, contentDir }
POST   /api/v1/auth/login                      body { password } -> sets cookie, { ok: true }
POST   /api/v1/auth/logout                     -> { ok: true }

GET    /api/v1/spaces                          -> { spaces: Space[] }
POST   /api/v1/spaces                          body { slug, name, icon? } -> { space: Space }

GET    /api/v1/tree                            -> { spaces: Array<Space & { tree: TreeNode[] }> }
GET    /api/v1/pages                           ?path=<PagePath> -> { page: Page }
                                               (no query) -> { pages: PageSummary[] }  (all, flat)
GET    /api/v1/pages/:id                       -> { page: Page }
POST   /api/v1/pages                           body { path, title, markdown?, icon?, tags?, props?, order? }
                                               -> 201 { page: Page }
PATCH  /api/v1/pages/:id                       body { title?, markdown?, icon?, tags?, props?, order?, path? }
                                               (path = move/rename) -> { page: Page }
DELETE /api/v1/pages/:id                       ?recursive=true -> { deleted: PagePath[] }

GET    /api/v1/search                          ?q=&space=&tag=&limit= -> { hits: SearchHit[] }
GET    /api/v1/pages/:id/backlinks             -> { backlinks: Backlink[] }
GET    /api/v1/pages/:id/history               ?limit= -> { revisions: Revision[] }
GET    /api/v1/pages/:id/revisions/:sha        -> { markdown, frontmatter: Frontmatter }

GET    /api/v1/views                           ?dir=<PagePath>&where=<k:v,k:v>&sort=<key>&order=asc|desc
                                               -> { columns: string[], rows: PageSummary[] }
                                               (a table over child pages' frontmatter props)

GET    /api/v1/git/status                      -> { status: GitStatus }
POST   /api/v1/git/pull                        -> { status: GitStatus, pulled: number }
POST   /api/v1/git/push                        -> { status: GitStatus, pushed: boolean }
POST   /api/v1/git/commit                      body { message? } -> { sha: string | null }

POST   /api/v1/assets                          multipart -> { url, path }
```

ERRORS: always `{ error: { code: string, message: string } }` with a proper HTTP status.
Codes: `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `UNAUTHORIZED`, `GIT_ERROR`, `INTERNAL`

## CONFIG

Read from env, all packages use `@gitdocs/shared`'s `loadConfig()`:

| Variable | Default |
| --- | --- |
| `GITDOCS_CONTENT_DIR` | `/Users/pmihaylov/prg/repos/gitdocs/.data/content` |
| `GITDOCS_PORT` | `4000` |
| `GITDOCS_API_TOKENS` | comma-separated bearer tokens |
| `GITDOCS_PASSWORD` | web UI password |
| `GITDOCS_SESSION_SECRET` | cookie signing secret |
| `GITDOCS_GIT_REMOTE` | optional git remote URL |
| `GITDOCS_GIT_BRANCH` | `main` |
| `GITDOCS_GIT_AUTHOR_NAME` | `gitdocs` |
| `GITDOCS_GIT_AUTHOR_EMAIL` | `gitdocs@localhost` |
| `GITDOCS_AUTOCOMMIT_MS` | debounce before auto-commit, default `5000` |
| `GITDOCS_AUTOPULL_MS` | periodic pull interval, default `60000`, `0` = off |
