# @tablinum/mcp

An MCP server that lets Claude Code, or any other MCP client, read and edit a tablinum site. It runs
two ways: as the stdio CLI in this package, and as the remote endpoint the tablinum server hosts at
`POST /api/v1/mcp`. Both expose the same tools, the same resource and the same prompt.

The server is a thin, model-friendly front end over the tablinum REST API. It never touches the
content directory itself, so every change made by an agent goes through exactly the same code path
as a change made by a human in the web editor: the same validation, the same search index update
and the same git commit. An agent and a person can work on the same page without corrupting each
other's work.

## Requirements

- Node 22 or newer.
- A running tablinum server (`@tablinum/server`), reachable over HTTP.
- A bearer token from that server's `TABLINUM_API_TOKENS`, unless the server runs in open mode.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TABLINUM_URL` | `http://127.0.0.1:4000` | Base URL of the tablinum server. |
| `TABLINUM_TOKEN` | unset | Bearer token. One of the server's `TABLINUM_API_TOKENS`. Leave unset when the server runs in open mode. |

The flags `--url` and `--token` override the environment. `--help` and `--version` print and exit.

```bash
tablinum-mcp --url https://docs.internal.example.com --token gd_live_...
```

stdout carries MCP protocol frames only. Every log line goes to stderr.

## Register it with Claude Code

Run this from the directory you want the server available in:

```bash
claude mcp add tablinum \
  --scope project \
  --env TABLINUM_URL=http://127.0.0.1:4000 \
  --env TABLINUM_TOKEN=your-token-here \
  -- npx -y @tablinum/mcp
```

Use `--scope user` instead of `--scope project` to make it available in every project, or
`--scope local` to keep it to the current project and only for you.

Inside this monorepo, before the package is published, point at the built entry point instead:

```bash
pnpm --filter @tablinum/mcp build

claude mcp add tablinum \
  --scope project \
  --env TABLINUM_URL=http://127.0.0.1:4000 \
  --env TABLINUM_TOKEN=your-token-here \
  -- node /absolute/path/to/tablinum/packages/mcp/dist/cli.js
```

Verify the registration:

```bash
claude mcp list
claude mcp get tablinum
```

### The equivalent `.mcp.json`

`claude mcp add --scope project` writes this file for you. Commit it so the whole team gets the
server, and keep the real token in the environment rather than in the file.

```json
{
  "mcpServers": {
    "tablinum": {
      "command": "npx",
      "args": ["-y", "@tablinum/mcp"],
      "env": {
        "TABLINUM_URL": "http://127.0.0.1:4000",
        "TABLINUM_TOKEN": "your-token-here"
      }
    }
  }
}
```

The local, unpublished form of the same file:

```json
{
  "mcpServers": {
    "tablinum": {
      "command": "node",
      "args": ["/absolute/path/to/tablinum/packages/mcp/dist/cli.js"],
      "env": {
        "TABLINUM_URL": "http://127.0.0.1:4000",
        "TABLINUM_TOKEN": "your-token-here"
      }
    }
  }
}
```

## The remote endpoint

`@tablinum/server` mounts these same tools at `POST /api/v1/mcp`, so an agent needs no local process.
Add an agent in the web UI (account menu, then **Agents**), copy its token, and point the client at
the address:

```json
{
  "mcpServers": {
    "tablinum": {
      "type": "http",
      "url": "http://127.0.0.1:4000/api/v1/mcp",
      "headers": { "Authorization": "Bearer gda_your-agent-token" }
    }
  }
}
```

The endpoint is stateless: every request carries its own credential, so nothing expires and nothing
is lost when the server restarts. An agent token also gives the agent an identity: the handshake
instructions start with its name, its `@handle` and the brief an admin wrote for it.

Any other credential works too, for example one of `TABLINUM_API_TOKENS`. Those name nobody, so the
instructions carry the shared tool guidance alone.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `tablinum_search` | `query`, `space?`, `limit?` | Ranked hits with title, path, id, score and a one line snippet. |
| `tablinum_get_page` | `path?`, `id?` | A metadata header plus the markdown body, verbatim. |
| `tablinum_list_tree` | `space?` | The page tree as an indented outline, one line per page. |
| `tablinum_create_page` | `path`, `title`, `markdown`, `icon?`, `order?` | The new page as a one line summary. |
| `tablinum_update_page` | `id?`/`path?`, `title?`, `markdown?`, `icon?`, `order?` | Which fields changed, plus the page summary. |
| `tablinum_append_page` | `id?`/`path?`, `markdown` | How much was appended, plus the page summary. |
| `tablinum_move_page` | `id?`/`path?`, `newPath` | The new path, plus the page summary. |
| `tablinum_delete_page` | `id?`/`path?`, `recursive?` | Every deleted path. |
| `tablinum_page_history` | `id?`/`path?`, `limit?` | Short sha, date, author and subject per commit. |
| `tablinum_git_sync` | `push?` | Commit, pull and push outcome, plus the git status. |

Design rules that make these usable by a model:

- **Either id or path.** Every page tool takes the stable `id` or the current `path` and resolves
  it. Passing neither returns a `VALIDATION` error that names both options and tells the model to
  call `tablinum_list_tree` or `tablinum_search` first. Passing a path in the `id` field is detected
  and named.
- **Partial updates are safe.** `tablinum_update_page` sends only the fields the model supplied. If
  `markdown` is omitted, no `markdown` key reaches the API and the body stays exactly as it was,
  so a metadata-only edit can never blank a page.
- **Appending never rewrites.** `tablinum_append_page` reads the current body, adds a blank line and
  writes the addition after it, so a model can add a section without holding the whole page.
- **Compact text, not JSON dumps.** Search results, the tree and history come back as short
  lines a model can read cheaply. Only `tablinum_get_page` returns the full markdown, byte for byte.
- **Errors are actionable.** Every API error becomes `CODE: message` followed by `What to do: ...`,
  for example a `CONFLICT` tells the model to update the existing page instead of recreating it.

## Resource

`tablinum://tree` (`text/markdown`) is the whole page hierarchy as an indented outline:

```
Engineering  (space "eng")
  - 📕 Runbooks  [eng/runbooks]
    - Deploy runbook  [eng/runbooks/deploy]

2 pages in 1 space.
```

Attach it to a conversation to give a model the map of the site without spending a tool call.

## Prompt

`tablinum_style_guide` carries the house conventions for writing pages here: the server owns the
frontmatter, headings start at `##`, page links use `[[page-path]]`, paths are lowercase kebab-case,
and metadata-only edits omit `markdown`. It takes an optional `space` argument, which adds guidance for that space.

## Development

```bash
pnpm --filter @tablinum/mcp build       # tsc -b, emits dist/
pnpm --filter @tablinum/mcp typecheck
pnpm --filter @tablinum/mcp test        # vitest, mocked fetch
pnpm --filter @tablinum/mcp dev         # run from source with tsx
```

The test suite drives every tool against a mocked `fetch`, and also connects a real MCP client over
an in-memory transport to check the advertised tools, the resource and the prompt.

## Embedding it

The package is also a library, so a host process can reuse the pieces:

```ts
import { TablinumClient, createTablinumMcpServer, getToolSpec } from '@tablinum/mcp';

const client = new TablinumClient({ baseUrl: 'http://127.0.0.1:4000', token: process.env.TABLINUM_TOKEN });

// A fully wired MCP server, ready for any transport.
const server = createTablinumMcpServer({ client });

// `identity` goes in front of the standard instructions, which is how the remote endpoint
// tells one agent from another.
const briefed = createTablinumMcpServer({ client, identity: 'You are Doc Bot. Keep the runbooks tidy.' });

// Or run one tool directly and get the same text a model would see.
const outline = await getToolSpec('tablinum_list_tree').run(client, {});
```
