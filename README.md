# gitdocs

A self-hosted docs app with a modern block editor, where **every page is just a markdown file with
YAML frontmatter in a git repo**.

Two audiences edit the same content and neither corrupts the other:

- **Humans** use the web editor: block editing, a slash menu, a drag-to-reorder page tree, a command
  palette, instant search, clean typography, light and dark themes.
- **Agents** use the REST API, the MCP server, or a plain `git clone` and a text editor.

Every write on either side lands as a commit in the content repo. Nothing is hidden in a database
you cannot read.

> **gitdocs has no connection to Notion.** There is no import, no Notion API client and no sync.
> The only thing borrowed is the *look and feel* of that style of editor. Your content stays in
> markdown files that you own.

---

## Architecture

```
                    HUMANS                                AGENTS (Claude)
                       |                                         |
              +--------v---------+                    +----------v----------+
              |  apps/web        |                    |  packages/mcp       |
              |  React + Vite    |                    |  MCP stdio server   |
              |  TipTap editor   |                    |  gitdocs_* tools    |
              +--------+---------+                    +----------+----------+
                       |  fetch + session cookie                 |  bearer token
                       |                                         |
                       +--------------------+--------------------+
                                            |
                                 +----------v-----------+
                                 |  apps/server         |
                                 |  Fastify REST API    |
                                 |  /api/v1/*           |
                                 +----------+-----------+
                                            |
              +-----------------------------+-----------------------------+
              |                             |                             |
   +----------v----------+     +------------v-----------+     +-----------v----------+
   |  packages/core      |     |  packages/search       |     |  packages/git-sync   |
   |  read/write .md     |     |  sqlite FTS5 index     |     |  commit/pull/push    |
   |  frontmatter, tree  |     |  snippets, backlinks   |     |  debounced autosave  |
   |  id index, moves    |     |                        |     |  history, revisions  |
   +----------+----------+     +------------+-----------+     +-----------+----------+
              |                             |                             |
              +-----------------------------+-----------------------------+
                                            |
                              +-------------v--------------+
                              |  CONTENT REPO (a git repo) |
                              |  ${GITDOCS_CONTENT_DIR}    |
                              |  <space>/index.md          |
                              |  <space>/page.md           |
                              |  _assets/<pageId>/...      |
                              +-------------+--------------+
                                            |
                                    optional git remote
                                  (GITDOCS_GIT_REMOTE)

   packages/shared - types, zod schemas, config, ids, path rules. Every box above imports it.
```

## Packages

| Path | Package | What it does |
| --- | --- | --- |
| `packages/shared` | `@gitdocs/shared` | Types, zod schemas, config loader, page ids, path rules |
| `packages/core` | `@gitdocs/core` | Content store: files, frontmatter, page tree, id index |
| `packages/git-sync` | `@gitdocs/git-sync` | Git engine: auto-commit, pull, push, history |
| `packages/search` | `@gitdocs/search` | SQLite FTS5 index and backlinks |
| `packages/mcp` | `@gitdocs/mcp` | MCP stdio server for agents |
| `apps/server` | `@gitdocs/server` | Fastify REST API |
| `apps/web` | `@gitdocs/web` | React + Vite + TipTap editor |
| `deploy` | - | Dockerfile, docker-compose.yml, ops guide |

## Quickstart

Requires Node 22 and pnpm 10.

```bash
git clone <this-repo> gitdocs
cd gitdocs
pnpm install
cp .env.example .env      # then edit .env
pnpm build
pnpm dev                  # API on :4000, web on :5173
```

Open http://localhost:5173 and log in with `GITDOCS_PASSWORD`.

On first boot gitdocs creates the content repo at `GITDOCS_CONTENT_DIR`, runs `git init` in it and
writes a starter space. That directory is a normal git repo: clone it, edit it, commit to it.

Point it at an existing repo of markdown instead:

```bash
git clone git@example.com:team/docs.git ~/docs
GITDOCS_CONTENT_DIR=~/docs pnpm dev
```

### Common tasks

```bash
pnpm build       # build every package
pnpm typecheck   # strict tsc across the workspace
pnpm test        # vitest across the workspace
pnpm dev         # API and web together, with reload
```

## Content format

The content directory is a git repo. It looks like this:

```
content/
  engineering/
    _space.yml            # { name, icon, order } - describes the space
    index.md              # the space home page
    getting-started.md    # a leaf page
    runbooks/
      index.md            # the "runbooks" page itself
      deploy.md           # a child of "runbooks"
  _assets/
    pg_01J8XYZ.../diagram.png
```

Rules:

- A page is **either** `<name>.md` (a leaf) **or** `<name>/index.md` (a page that has children).
- The page path is the file path relative to the content root, without `.md` and without a trailing
  `/index`:

  | File | Page path |
  | --- | --- |
  | `engineering/index.md` | `engineering` |
  | `engineering/getting-started.md` | `engineering/getting-started` |
  | `engineering/runbooks/index.md` | `engineering/runbooks` |
  | `engineering/runbooks/deploy.md` | `engineering/runbooks/deploy` |

- Adding a child under a leaf promotes it: `foo.md` becomes `foo/index.md`. Removing the last child
  demotes it back. gitdocs does this for you, and the page id never changes.
- Attachments live in `_assets/<pageId>/<filename>` and are referenced as
  `/_assets/<pageId>/<filename>`.

### Frontmatter

Every page file starts with a YAML block, always in this key order:

```markdown
---
id: pg_01J8XYZABCDEFGHJKMNPQRST   # "pg_" + ULID. Stable. Never changes on rename or move.
title: Deploy runbook             # required
icon: "🚀"                        # optional, single emoji
tags: [ops, deploy]               # optional
order: 10                         # optional, sorts siblings. Missing = sort by title.
created: 2026-08-08T10:00:00.000Z # ISO 8601 UTC
updated: 2026-08-08T10:00:00.000Z # ISO 8601 UTC
props:                            # optional user properties; these power the table view
  status: draft
  owner: pmihaylov
---

The body is plain CommonMark + GFM: tables, task lists, strikethrough, autolinks.
Wikilinks work too: [[engineering/runbooks/deploy]] and [[engineering/deploy|the runbook]].
```

`props` values may be a string, a number, a boolean, a list of strings, or null.

`GET /api/v1/views` turns the `props` of a directory's child pages into a table, so a folder of
pages behaves like a database with columns, filters and sorting.

## REST API

Base URL `http://localhost:4000/api/v1`. JSON in, JSON out.

Authentication:

- Agents send `Authorization: Bearer <token>`, with tokens from `GITDOCS_API_TOKENS`.
- The web UI posts to `/auth/login` and gets a signed httpOnly session cookie.
- Both grant the same access.
- If `GITDOCS_API_TOKENS` and `GITDOCS_PASSWORD` are both unset, gitdocs runs in **open mode** with
  no authentication and logs a loud warning. Use that for local work only.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/health` | - | `{ ok, version, contentDir }` |
| POST | `/auth/login` | `{ password }` | `{ ok: true }` + session cookie |
| POST | `/auth/logout` | - | `{ ok: true }` |
| GET | `/spaces` | - | `{ spaces: Space[] }` |
| POST | `/spaces` | `{ slug, name, icon? }` | `{ space: Space }` |
| GET | `/tree` | - | `{ spaces: Array<Space & { tree: TreeNode[] }> }` |
| GET | `/pages` | `?path=<pagePath>` | `{ page: Page }` |
| GET | `/pages` | - | `{ pages: PageSummary[] }` (flat, all pages) |
| GET | `/pages/:id` | - | `{ page: Page }` |
| POST | `/pages` | `{ path, title, markdown?, icon?, tags?, props?, order? }` | `201 { page: Page }` |
| PATCH | `/pages/:id` | `{ title?, markdown?, icon?, tags?, props?, order?, path? }` | `{ page: Page }` |
| DELETE | `/pages/:id` | `?recursive=true` | `{ deleted: PagePath[] }` |
| GET | `/search` | `?q=&space=&tag=&limit=` | `{ hits: SearchHit[] }` |
| GET | `/pages/:id/backlinks` | - | `{ backlinks: Backlink[] }` |
| GET | `/pages/:id/history` | `?limit=` | `{ revisions: Revision[] }` |
| GET | `/pages/:id/revisions/:sha` | - | `{ markdown, frontmatter }` |
| GET | `/views` | `?dir=&where=k:v,k:v&sort=&order=asc\|desc` | `{ columns: string[], rows: PageSummary[] }` |
| GET | `/git/status` | - | `{ status: GitStatus }` |
| POST | `/git/pull` | - | `{ status: GitStatus, pulled: number }` |
| POST | `/git/push` | - | `{ status: GitStatus, pushed: boolean }` |
| POST | `/git/commit` | `{ message? }` | `{ sha: string \| null }` |
| POST | `/assets` | multipart | `{ url, path }` |

Sending `path` in `PATCH /pages/:id` moves or renames the page. Its id and its history follow it.

Errors always come back as:

```json
{ "error": { "code": "NOT_FOUND", "message": "No page at eng/deploy" } }
```

Codes: `NOT_FOUND` (404), `CONFLICT` (409), `VALIDATION` (400), `UNAUTHORIZED` (401),
`GIT_ERROR` (502), `INTERNAL` (500).

Example:

```bash
curl -s http://localhost:4000/api/v1/pages \
  -H "Authorization: Bearer $GITDOCS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"path":"engineering/runbooks/deploy","title":"Deploy runbook","markdown":"# Deploy\n"}'
```

## Point Claude at the MCP server

`@gitdocs/mcp` speaks MCP over stdio, so Claude can read and write pages directly.

Claude Code:

```bash
claude mcp add gitdocs -- node /absolute/path/to/gitdocs/packages/mcp/dist/index.js
```

Claude Desktop - add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gitdocs": {
      "command": "node",
      "args": ["/absolute/path/to/gitdocs/packages/mcp/dist/index.js"],
      "env": {
        "GITDOCS_CONTENT_DIR": "/absolute/path/to/your/content",
        "GITDOCS_API_TOKENS": "your-token"
      }
    }
  }
}
```

Restart the client, then ask Claude to search the docs, read a page, or write one. Every change it
makes is a commit you can review with `git log` and revert with `git revert`.

## Configuration

All configuration comes from environment variables. See `.env.example` for the annotated list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITDOCS_CONTENT_DIR` | `<repo>/.data/content` | Absolute path to the content git repo |
| `GITDOCS_PORT` | `4000` | REST API port |
| `GITDOCS_API_TOKENS` | - | Comma-separated bearer tokens |
| `GITDOCS_PASSWORD` | - | Web UI password |
| `GITDOCS_SESSION_SECRET` | random per boot | Cookie signing secret |
| `GITDOCS_GIT_REMOTE` | - | Optional remote for the content repo |
| `GITDOCS_GIT_BRANCH` | `main` | Branch to commit, pull and push |
| `GITDOCS_GIT_AUTHOR_NAME` | `gitdocs` | Commit author name |
| `GITDOCS_GIT_AUTHOR_EMAIL` | `gitdocs@localhost` | Commit author email |
| `GITDOCS_AUTOCOMMIT_MS` | `5000` | Debounce before an automatic commit; `0` disables it |
| `GITDOCS_AUTOPULL_MS` | `60000` | Background pull interval; `0` disables it |

## Contributing

`CONTRACT.md` is the frozen interface between the packages: the on-disk format, the shared types,
the REST API and the config. Read it before you change anything, and change it only with a matching
change in every package.
