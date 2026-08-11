# tablinum

A self-hosted docs app with a modern block editor, where **every page is just a markdown file with
YAML frontmatter in a git repo**.

Two audiences edit the same content and neither corrupts the other:

- **Humans** use the web editor: block editing, a slash menu, a drag-to-reorder page tree, a command
  palette, instant search, clean typography, light and dark themes.
- **Agents** use the REST API, the MCP server (stdio or remote), or a plain `git clone` and a text editor.

Every write on either side lands as a commit in the content repo. Nothing is hidden in a database
you cannot read.

> **tablinum has no connection to Notion.** There is no import, no Notion API client and no sync.
> The only thing borrowed is the *look and feel* of that style of editor. Your content stays in
> markdown files that you own.

---

## Architecture

```
                    HUMANS                                AGENTS (Claude)
                       |                                         |
              +--------v---------+                    +----------v----------+
              |  apps/web        |                    |  packages/mcp       |
              |  React + Vite    |                    |  MCP server         |
              |  TipTap editor   |                    |  tablinum_* tools    |
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
                              |  ${TABLINUM_CONTENT_DIR}    |
                              |  <space>/index.md          |
                              |  <space>/page.md           |
                              |  _assets/<pageId>/...      |
                              +-------------+--------------+
                                            |
                                    optional git remote
                                  (TABLINUM_GIT_REMOTE)

   packages/shared   - types, zod schemas, config, ids, path rules. Every box above imports it.
   packages/accounts - people, passwords, sessions, invites, avatars, workspaces and their
                       members. A second sqlite file next to the search index, one level ABOVE
                       the content repo. Never committed.

   The content repo above is the DEFAULT workspace. Every other workspace repeats the bottom
   three boxes: its own repository, its own search index and its own git engine. See "Workspaces".
```

## Packages

| Path | Package | What it does |
| --- | --- | --- |
| `packages/shared` | `@tablinum/shared` | Types, zod schemas, config loader, page ids, path rules |
| `packages/core` | `@tablinum/core` | Content store: files, frontmatter, page tree, id index |
| `packages/git-sync` | `@tablinum/git-sync` | Git engine: auto-commit, pull, push, history |
| `packages/search` | `@tablinum/search` | SQLite FTS5 index and backlinks |
| `packages/accounts` | `@tablinum/accounts` | SQLite accounts: people, passwords, sessions, invites, avatars |
| `packages/mcp` | `@tablinum/mcp` | MCP server for agents: a stdio CLI, and the tools behind `/api/v1/mcp` |
| `apps/server` | `@tablinum/server` | Fastify REST API |
| `apps/web` | `@tablinum/web` | React + Vite + TipTap editor |
| `deploy` | - | Dockerfile, docker-compose.yml, ops guide |

## Quickstart

Requires Node 22 and pnpm 10.

```bash
git clone <this-repo> tablinum
cd tablinum
pnpm install
cp .env.example .env      # then edit .env
pnpm build
pnpm dev                  # API on :4000, web on :5173
```

Open http://localhost:5173. Nobody has claimed a fresh server, so the sign-in screen asks you to
create the first account. You become the admin, and you name your first workspace on the next step.

On first boot tablinum creates the content repo at `TABLINUM_CONTENT_DIR`, runs `git init` in it and
writes a starter space. That directory is a normal git repo: clone it, edit it, commit to it.

Point it at an existing repo of markdown instead:

```bash
git clone git@example.com:team/docs.git ~/docs
TABLINUM_CONTENT_DIR=~/docs pnpm dev
```

### Common tasks

```bash
pnpm build       # build every package
pnpm typecheck   # strict tsc across the workspace
pnpm test        # vitest across the workspace
pnpm dev         # API and web together, with reload
pnpm e2e         # playwright browser tests, see below
```

### End-to-end tests

`e2e/` drives a real browser against a real server: the built `apps/server/dist/server.js`
serving the built `apps/web/dist`, over a content repo of its own. Install the browser once:

```bash
pnpm exec playwright install chromium
```

Then run the suite:

```bash
pnpm e2e                          # the whole suite
pnpm e2e e2e/search.spec.ts       # one spec file
pnpm e2e --headed --debug         # watch it, or step through it
pnpm e2e:ui                       # the playwright UI runner
```

Playwright starts and stops the server itself, and builds the workspace first when `dist` is
missing. Every run begins from an empty content repo, an empty `accounts.db` and a fresh admin
account, so no test depends on what the last run left.

- `TABLINUM_E2E_PORT=4310 pnpm e2e` moves the run to another port. The port names the server, the
  content directory and the saved session, so two runs on two ports never collide.
- `TABLINUM_E2E_SERVER_LOG=1 pnpm e2e` shows the server log, which is hidden by default.
- A failed test keeps a trace and a screenshot in `test-results/`. Replay one with
  `pnpm exec playwright show-trace test-results/<test>/trace.zip`, or open the whole run with
  `pnpm exec playwright show-report`. A green run leaves the report only.

## Live collaboration

Several people can edit the same page at the same time, from several browsers.

Every tab holds one WebSocket open at `/api/v1/live`. The server announces each page as its bytes
change, whoever changed them: a save from another tab, a file written straight into the content
repo, or a page rewritten by a `git pull`. All three arrive as the same message, so a colleague
and the git remote are handled by one mechanism.

Each save carries the revision it started from. The server rejects a save built on an old
revision and returns its own copy with the rejection. The browser then merges the two edits with
a three-way merge against the text it last had confirmed:

- **The edits touch different lines.** They merge silently, the merged text appears on screen, and
  it is saved again. Nobody is interrupted.
- **The edits touch the same lines.** A dialog opens with three choices: keep both sides with
  `<<<<<<<` markers and edit them by hand, keep only your version, or keep only theirs. The two
  versions that are not chosen are shown as a diff. Nothing is saved until you decide.

The people on a page are shown as coloured initials in the top bar. An avatar pulses while that
person has unsaved edits. Everybody on a page is named by their account, because a browser reaches
the app only once it has signed in.

**Git is the source of truth.** A pull that git cannot rebase does not silently lose anything: the
status pill in the sidebar turns into a conflict button, and the dialog behind it shows every file
with the local version, the remote version and an automatic merge of the two. Your resolution is
written to the working tree and committed like any other change.

## Comments

A comment is a conversation about a page, and it never touches the markdown. Threads live in
`accounts.db`, so a `git clone` of the content repo carries the words of the page and nothing that
was said about them.

A thread is about one of three things:

- **A run of text.** Select some words and choose Comment. The thread keeps the quote, so the
  highlight is found again on every load. Text that is edited away leaves the thread readable in
  the panel, marked as no longer on the page.
- **A database column.** Open the column header menu and choose "Comment on this column". The
  header then carries a badge with the number of open threads, and a click on the badge opens the
  usual comment panel on that thread. The thread holds the column id rather than the column name,
  so a rename keeps the conversation.
- **The whole page.** Open the panel and choose "Comment on the page".

Reply and Resolve work the same way whatever the thread is about, and a resolved thread comes back
with "Show resolved". Deleting a column deletes the threads about it. A column thread is recognised
by its column alone, so once the column is gone a reader has no way to tell what the thread was
about. A property deleted by hand in the page file never reaches the API, so the panel draws such a
thread as a column that is gone.

An `@handle` in a comment notifies that person. An agent works the same threads through the MCP
tools, with one limit: it opens a thread about a run of text or about the whole page, never about a
column. Column threads are read, replied to and resolved by an agent, but only a person starts one.
See "Tell an agent it was tagged" and "How an agent edits a page".

## Accounts, invites and avatars

Every person who reaches the web UI has an account. Machines are the exception: they send a bearer
token instead, either one from `TABLINUM_API_TOKENS` or a per-agent `gda_` token.

1. **Claim the server.** Open a fresh server and the sign-in screen asks for an email, a name and a
   password. The first visitor becomes the admin, and then names the workspace the server started
   with. The form works exactly once: from then on nobody reaches the API without a credential.
2. **Invite people.** As an admin, open Settings > Workspace and create an invite link. Leave the email
   empty for a link anybody may use, or pin it to one address so the link cannot be redirected.
   A link expires after 14 days by default and is spent once it is used.
3. **The invited person opens the link** at `/invite/<token>`, picks a display name and a password,
   and is signed in at once. Passwords are at least 10 characters. There is no character rule,
   because length beats cleverness.
4. **Profiles.** "Your account" holds the display name, the password and the avatar. An avatar is a
   PNG, JPEG, WebP or GIF of 512 KB or less. Changing a password signs every other browser out.

Roles are `admin` and `member`. An admin invites people, changes roles and removes accounts. Both
roles read and write every page of every workspace they are in, because a workspace is one git repo
and permissions do not divide inside it. To keep two sets of pages apart, use two workspaces.

Everything about a person lives in `accounts.db`, a SQLite file beside the search index and one
level above the content repo. Password hashes are scrypt. Sessions last 30 days and are rows in
that file, so signing out really does revoke the cookie.

> **`accounts.db` is the one file a git remote does not back up.** The content repo is backed up by
> its remote and the search index rebuilds itself. This file does neither. Back it up, or plan to
> re-invite everybody.

If the last admin loses their password, a CLI on the server is the way back in:

```bash
pnpm --filter @tablinum/server accounts list
pnpm --filter @tablinum/server accounts reset-password ada@example.com
pnpm --filter @tablinum/server accounts promote sam@example.com
```

In Docker it is `docker compose exec tablinum node /app/apps/server/dist/accounts-cli.js list`.

## Workspaces

A workspace is the top level, above spaces. Each one is a git repository of its own, so its spaces,
pages, attachments, search index, agents and live edits are completely separate from every other
workspace. One person belongs to as many workspaces as you put them in and switches between them
from the button at the top of the sidebar.

Every install starts with one workspace, `Main`: the content directory you configured. A server
with a single workspace behaves exactly as it did before, and you never have to think about this.

- **Create one.** Open the workspace button, choose "New workspace", give it a name and an icon.
  tablinum makes a git repository for it, gives it a `general` space and moves you into it.
- **Add people.** "Workspace settings" lists everybody in the workspace. Add somebody, make them an
  admin of it, or remove them. A workspace admin renames it, manages its people and exports it. An
  install admin reaches every workspace.
- **Switch.** Pick another workspace from the same menu. tablinum throws away everything cached
  about the old one, so nothing from one workspace can appear in another.

**Export** hands you a zip of the whole repository, `.git` included, so every page and its full
history travel with it. tablinum commits whatever is pending before it packs the archive.

**Import** takes that zip back, on this server or on any other tablinum, and registers it as a new
workspace. Importing the same archive twice gives you two independent workspaces: the second gets
its own slug and its own directory, and writing in one does not touch the other.

```
<parent of content dir>/
  content/               # the "Main" workspace: ${TABLINUM_CONTENT_DIR}
  search.db              # its search index
  accounts.db            # people, workspaces and who is in which
  workspaces/
    handbook/            # a second workspace, a git repo with the same layout
    handbook.search.db   # its search index, kept outside the repo so an export never holds it
```

Only `Main` uses `TABLINUM_GIT_REMOTE`; the others are local repositories you move with the zip.
Deleting a workspace forgets it and its members but leaves the files on disk, so export it first if
you want the pages.

## Mentions and Slack

Type `@` in the editor and pick a person. The page keeps plain `@handle` text, so a mention reads
the same in a terminal, in a diff and on GitHub, and nothing breaks when somebody is renamed.

Every account gets a handle when it is created, derived from the display name: "Ada Lovelace"
becomes `@ada.lovelace`. A second Ada Lovelace becomes `@ada.lovelace.2`. A handle never changes.
You find yours under "Your account".

A mention must start a word, so `mail@example.com` stays an address. A mention inside code, either
`@ada` in backticks or a line in a fenced block, names nobody.

To deliver notifications, connect a Slack app:

1. Create a Slack app in your workspace and give the bot the scopes `chat:write` and
   `users:read.email`.
2. Install it and set `TABLINUM_SLACK_BOT_TOKEN` to the bot token (`xoxb-...`).
3. Set `TABLINUM_PUBLIC_URL` to the origin people reach tablinum on, so the message can link to the
   page. Slack cannot resolve `localhost`.
4. Each person opens "Your account" and clicks "Connect Slack". tablinum matches their tablinum email
   address against Slack. If the two addresses differ, they paste their Slack member id instead.

On every save, tablinum compares the handles in the new body with the handles in the previous body
and sends a direct message for each handle that is new. Nothing is stored: there is no
notification table to fall out of step with the pages, and you never hear about your own mention.
A save never fails because Slack is unreachable.

## Custom emoji

Anybody who is signed in can upload an image and give it a name. Open the avatar menu, pick
"Custom emoji", choose a PNG, JPEG, WebP or GIF of up to 256 KB, and name it with lower-case
letters, digits, `_` and `-`.

After that `:name:` works wherever a unicode emoji works: in the body of a page, in the `:`
autocomplete, in the emoji picker, as a page icon and as a space or workspace icon. You delete your
own uploads; an admin deletes anybody's.

The page file keeps the plain `:name:` text and the image is resolved when the page is drawn, so
the content repo stays a tree of markdown and no `<img>` is ever written into a page. Only a name
somebody has uploaded is treated as an emoji, so `10:30:45` stays a time. The images live in
`accounts.db` beside the avatars, which means a git remote does not back them up.

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
  demotes it back. tablinum does this for you, and the page id never changes.
- Drag a page in the sidebar to reorder or reparent it inside its space. To send it to a different
  space, right-click it and pick **Move to space**: the page lands at the top level of the chosen
  space, takes its children with it, keeps every id, and opens right away. A space home page
  cannot be moved.
- The space switcher creates a space and edits one. Both use the same dialog: a name and an emoji
  icon. A new space is created with its home page and is opened at once. **Edit space** renames
  the open space and sets or clears its icon.
- Attachments live in `_assets/<pageId>/<filename>` and are referenced as
  `/_assets/<pageId>/<filename>`. An upload must carry an allowed extension: images, audio, video,
  `.pdf`, `.txt`, `.csv`, `.md`, `.json` or `.zip`. `.svg` and `.html` are refused, because a
  browser runs script from both. Anything that is not an image, an audio file or a video is served
  as a download, so an attachment stored before this rule cannot run either.

### Frontmatter

Every page file starts with a YAML block, always in this key order:

```markdown
---
id: pg_01J8XYZABCDEFGHJKMNPQRST   # "pg_" + ULID. Stable. Never changes on rename or move.
title: Deploy runbook             # required
icon: "🚀"                        # optional, single emoji
order: 10                         # optional, sorts siblings. Missing = sort by title.
created: 2026-08-08T10:00:00.000Z # ISO 8601 UTC
updated: 2026-08-08T10:00:00.000Z # ISO 8601 UTC
---

The body is plain CommonMark + GFM: tables, task lists, strikethrough, autolinks.
Wikilinks work too: [[engineering/runbooks/deploy]] and [[engineering/deploy|the runbook]].
Mentions are plain text: ask @ada.lovelace to review it.
```

## REST API

Base URL `http://localhost:4000/api/v1`. JSON in, JSON out.

Authentication:

- Agents send `Authorization: Bearer <token>`, with tokens from `TABLINUM_API_TOKENS`.
- The web UI posts `{ email, password }` to `/auth/login` and gets a signed httpOnly session cookie.
- Both grant the same access to the content. Only an account names a person.
- `POST /auth/setup` is the one public write. It creates the first admin on a server that has no
  account yet, and it refuses every later call.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/health` | - | `{ ok, version, contentDir }` |
| POST | `/auth/login` | `{ email, password }` | `{ ok, user }` + session cookie |
| POST | `/auth/logout` | - | `{ ok: true }` |
| GET | `/auth/state` | - | `{ setupRequired, user }` |
| POST | `/auth/setup` | `{ email, name, password }` | `{ ok, user }` (first admin only) |
| GET | `/auth/invite/:token` | - | `{ email, role, expires, invitedBy }` |
| POST | `/auth/register` | `{ token, email?, name, password }` | `{ ok, user }` + session cookie |
| GET | `/me` | - | `{ user: Account \| null }` |
| PATCH | `/me` | `{ name?, color? }` | `{ user: Account }` |
| POST | `/me/password` | `{ current, next }` | `{ ok: true }` |
| POST | `/me/avatar` | multipart `file` | `{ url, rev }` |
| DELETE | `/me/avatar` | - | `{ ok: true }` |
| GET | `/users` | - | `{ users: Account[] }` |
| GET | `/users/:id/avatar` | `?v=<rev>` | the image bytes |
| PATCH | `/users/:id` | `{ name?, role?, disabled? }` | `{ user: Account }` (admin) |
| DELETE | `/users/:id` | - | `{ ok: true }` (admin) |
| GET | `/emoji` | - | `{ emoji: CustomEmoji[] }` |
| POST | `/emoji` | multipart `shortcode`, `file` | `{ emoji: CustomEmoji }` (any account) |
| GET | `/emoji/:shortcode/image` | - | the image bytes |
| DELETE | `/emoji/:id` | - | `{ ok: true }` (the uploader, or an admin) |
| GET | `/invites` | - | `{ invites: Invite[] }` (admin) |
| POST | `/invites` | `{ email?, role?, expiresInDays? }` | `{ invite, url }` (admin) |
| DELETE | `/invites/:id` | - | `{ ok: true }` (admin) |
| GET | `/workspaces` | - | `{ workspaces: Workspace[], current }` |
| POST | `/workspaces` | `{ name, slug?, icon? }` | `201 { workspace }` (admin) |
| PATCH | `/workspaces/:id` | `{ name?, slug?, icon? }` | `{ workspace }` (workspace admin) |
| DELETE | `/workspaces/:id` | - | `{ ok: true }` (admin; never the default one) |
| GET | `/workspaces/:id/members` | - | `{ members: WorkspaceMember[] }` |
| POST | `/workspaces/:id/members` | `{ userId, role? }` | `{ ok: true }` (workspace admin) |
| PATCH | `/workspaces/:id/members/:userId` | `{ role }` | `{ ok: true }` (workspace admin) |
| DELETE | `/workspaces/:id/members/:userId` | - | `{ ok: true }` (workspace admin) |
| GET | `/workspaces/:id/export` | - | the zip bytes (workspace admin) |
| POST | `/workspaces/import` | multipart `file`, `name?` | `201 { workspace }` (admin) |
| GET | `/spaces` | - | `{ spaces: Space[] }` |
| POST | `/spaces` | `{ slug, name, icon? }` | `{ space: Space }` (also writes the home page) |
| PATCH | `/spaces/:slug` | `{ name?, icon?, order? }` | `{ space: Space }` (`icon: null` clears it) |
| GET | `/tree` | - | `{ spaces: Array<Space & { tree: TreeNode[] }> }` |
| GET | `/pages` | `?path=<pagePath>` | `{ page: Page }` |
| GET | `/pages` | - | `{ pages: PageSummary[] }` (flat, all pages) |
| GET | `/pages/:id` | - | `{ page: Page }` |
| POST | `/pages` | `{ path, title, markdown?, icon?, order? }` | `201 { page: Page }` |
| PATCH | `/pages/:id` | `{ title?, markdown?, icon?, order?, path?, baseRev? }` | `{ page: Page }` |
| DELETE | `/pages/:id` | `?recursive=true` | `{ deleted: PagePath[] }` |
| GET | `/search` | `?q=&space=&limit=` | `{ hits: SearchHit[] }` |
| GET | `/pages/:id/backlinks` | - | `{ backlinks: Backlink[] }` |
| GET | `/pages/:id/history` | `?limit=` | `{ revisions: Revision[] }` |
| GET | `/pages/:id/revisions/:sha` | - | `{ markdown, frontmatter }` |
| GET | `/git/status` | - | `{ status: GitStatus }` |
| POST | `/git/pull` | - | `{ status: GitStatus, pulled: number }` |
| POST | `/git/push` | - | `{ status: GitStatus, pushed: boolean }` |
| POST | `/git/commit` | `{ message? }` | `{ sha: string \| null }` |
| GET | `/git/conflict` | - | `{ conflict, files: ConflictFile[] }` |
| POST | `/git/resolve` | `{ files: [{ file, content }], message? }` | `{ status, resolved: string[] }` |
| POST | `/assets` | multipart | `{ url, path }` |
| GET | `/live` | `?client=<tab id>&workspace=<slug>` | WebSocket |

Every content endpoint answers about one workspace. Name it with the `x-tablinum-workspace` header,
or with `?workspace=` on a link and on the WebSocket upgrade. Send neither and you get your first
workspace, which is the only one a single-workspace install has. An agent token names its own
workspace and ignores both.

Sending `path` in `PATCH /pages/:id` moves or renames the page. Its id and its history follow it.

Sending `baseRev` with `markdown` makes the save conditional. `Page.rev` is a fingerprint of the
body; send the `rev` your edit started from. If the page moved on, the save fails with `409
CONFLICT` and the response carries the current copy, so the caller can merge and retry:

```json
{ "error": { "code": "CONFLICT", "message": "The page changed since this edit started",
             "info": { "markdown": "...", "rev": "...", "updated": "..." } } }
```

A save without `baseRev` always wins, which is what a scripted edit usually wants.

Errors always come back as:

```json
{ "error": { "code": "NOT_FOUND", "message": "No page at eng/deploy" } }
```

Codes: `NOT_FOUND` (404), `CONFLICT` (409), `VALIDATION` (400), `UNAUTHORIZED` (401),
`GIT_ERROR` (502), `INTERNAL` (500).

Example:

```bash
curl -s http://localhost:4000/api/v1/pages \
  -H "Authorization: Bearer $TABLINUM_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"path":"engineering/runbooks/deploy","title":"Deploy runbook","markdown":"# Deploy\n"}'
```

## Point Claude at the MCP server

`@tablinum/mcp` speaks MCP over stdio, so Claude can read and write pages directly.

Claude Code:

```bash
claude mcp add tablinum -- node /absolute/path/to/tablinum/packages/mcp/dist/index.js
```

Claude Desktop - add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tablinum": {
      "command": "node",
      "args": ["/absolute/path/to/tablinum/packages/mcp/dist/index.js"],
      "env": {
        "TABLINUM_CONTENT_DIR": "/absolute/path/to/your/content",
        "TABLINUM_API_TOKENS": "your-token"
      }
    }
  }
}
```

Restart the client, then ask Claude to search the docs, read a page, or write one. Every change it
makes is a commit you can review with `git log` and revert with `git revert`.

## Give an agent its own identity

The server also speaks MCP over HTTP at `/api/v1/mcp`, so an agent needs no local process at all.
Each agent gets its own credential and its own identity brief.

1. Sign in as an admin, open **Settings**, and choose **Agents**.
2. Give the agent a name and write its identity. The identity is the first thing the agent reads
   when it connects, so write it as instructions to the agent itself, for example: "You look after
   the engineering runbooks. Keep every step numbered."
3. Copy the token. It is shown once and never again.
4. Give the agent a picture if you want one. Open **Edit** on its row and upload a PNG, JPEG,
   WebP or GIF of up to 512 KB. Until then it shows its initials, exactly like a person.

Point any MCP client at the address the dialog shows:

```json
{
  "mcpServers": {
    "tablinum": {
      "type": "http",
      "url": "http://localhost:4000/api/v1/mcp",
      "headers": { "Authorization": "Bearer gda_your-agent-token" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http tablinum http://localhost:4000/api/v1/mcp \
  --header "Authorization: Bearer gda_your-agent-token"
```

The agent gets the same tools as the stdio server, plus its own brief in the handshake. It reads
and writes pages, but it never administers the site: agent tokens are not admin credentials. Every
agent has a `@handle`, taken from the same namespace as the people, so `@doc.bot` names one writer
and one only. Issue an agent a new token from the same page, and the old one stops working at once.
There is no paused state: delete the agent to stop it, and its token dies with it.

An agent at work is visible. When it reads or writes a page, a chip joins the presence strip on
that page, next to the people already there. The chip shows the agent's picture, or a robot mark
while it has none. The chip pulses while the agent
writes, and it leaves about a minute after the agent's last tool call. An agent edit also arrives
in the open editor as it happens: the text updates in place, your own unsaved edits are kept, and
a small message names the agent that wrote.

## Tell an agent it was tagged

An agent has no inbox, so it is told over HTTP. Give an agent a webhook address, and every time a
page or a comment writes its `@handle`, tablinum posts one signed event there.

1. Set `TABLINUM_WEBHOOK_SECRET` on the server to a value of at least 16 characters, for example
   `openssl rand -hex 32`. Nothing is ever delivered unsigned, so an unset secret turns agent
   webhooks off, and the Agents page says so.
2. Open **Settings**, choose **Agents**, and put the address in the webhook field. Only `http://`
   and `https://` are accepted.
3. Set `TABLINUM_PUBLIC_URL` if you want the event to carry a link a person can open.

The body is JSON:

```json
{
  "id": "whd_01K2ZQ8P7M0000000000000000",
  "type": "mention.comment",
  "created": "2026-08-11T09:14:02.317Z",
  "agent": { "id": "ag_...", "name": "Doc Bot", "handle": "doc.bot" },
  "workspace": { "id": "ws_...", "slug": "main", "name": "Main" },
  "page": {
    "id": "pg_...",
    "path": "eng/plan",
    "title": "The plan",
    "url": "https://docs.example.com/p/eng/plan"
  },
  "by": { "id": "us_...", "name": "Ada Lovelace", "handle": "ada.lovelace" },
  "thread": { "id": "th_..." },
  "text": "What do you think, @doc.bot?"
}
```

`type` is `mention.page` when the handle is written in the body of a page, and `mention.comment`
when it is written in a comment. `thread` is null for a page mention. `by` is null when the write
arrived under an operator token, which names nobody. `text` is the whole page body for a page
mention, and the comment itself for a comment mention. Only what a save *adds* is delivered, so a
handle that was already there is never announced twice.

Three headers come with it:

| Header | What it carries |
| --- | --- |
| `x-tablinum-signature` | `t=<unix seconds>,v1=<hex>` |
| `x-tablinum-event` | The event type, so you can route without parsing the body |
| `x-tablinum-delivery` | The delivery id, the same value as `id` in the body |

### Verify the signature

The signature is HMAC-SHA256 over `<timestamp>.<raw body>`, keyed with `TABLINUM_WEBHOOK_SECRET`,
in lower-case hex. Sign the exact bytes you received, before any JSON parse:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;   // refuse a replayed delivery
  const wanted = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return wanted.length === parts.v1.length &&
    timingSafeEqual(Buffer.from(wanted), Buffer.from(parts.v1));
}
```

`GET /api/v1/webhooks/signing` describes the scheme, so a receiver can check it holds the right
secret without ever sending it:

```json
{
  "enabled": true,
  "algorithm": "hmac-sha256",
  "keyId": "3f1c9a5b2e7d4086",
  "signatureHeader": "x-tablinum-signature",
  "eventHeader": "x-tablinum-event",
  "deliveryHeader": "x-tablinum-delivery",
  "toleranceSeconds": 300
}
```

`keyId` is a salted SHA-256 of the secret, cut to 16 hex characters. It names the secret and
reveals nothing, so two servers that hold the same secret report the same id.

Answer with any 2xx. A delivery that fails is logged and dropped: a save never fails because a
receiver is unreachable, and there is no retry queue to fall out of step with the pages. Store
`x-tablinum-delivery` and ignore an id you have already handled.

## How an agent edits a page

An agent works on a page the way a person does. It opens the page, puts a caret somewhere, selects
some text, and types over it. There is no tool that replaces a whole page in one call, so an agent
must look at the text before it changes any of it.

| Tool | What it does |
| --- | --- |
| `tablinum_open_page` | Shows the page as numbered blocks and puts the caret on it |
| `tablinum_place_cursor` | Moves the caret: to a phrase, to a block and offset, or to the start or end |
| `tablinum_select` | Selects a phrase, a block, a run of blocks, or the whole page |
| `tablinum_type` | Types text. It replaces the selection, exactly like a keyboard |
| `tablinum_erase` | Erases the selection, or a number of characters each side of the caret |

A block is a paragraph, a heading, a list or a code block: one run of lines with a blank line on
each side. The caret is said in a block number and a character offset inside that block, and the
server keeps one caret per credential per page, so an agent can read, think, and come back to the
same place. Two agents never share a caret.

The caret is on screen while the agent works. Everybody reading the page sees it move, sees the
text it selects, and sees the agent's name beside it, the same way they see another person's
caret. Nothing happens behind a curtain.

An agent reviews as well as writes. `tablinum_comment` opens a comment thread on the words it
quotes, `tablinum_reply` answers a thread somebody opened, and `tablinum_resolve_comment` closes
one. The card in the comment panel carries the agent's name and picture, next to the people. A
thread quotes what a reader sees rather than the markdown behind it, and a comment never reaches
the markdown file.

## Configuration

All configuration comes from environment variables. See `.env.example` for the annotated list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TABLINUM_CONTENT_DIR` | `<repo>/.data/content` | Absolute path to the content git repo |
| `TABLINUM_PORT` | `4000` | REST API port |
| `TABLINUM_API_TOKENS` | - | Comma-separated bearer tokens |
| `TABLINUM_SESSION_SECRET` | random per boot | Cookie signing secret |
| `TABLINUM_GIT_REMOTE` | - | Optional remote for the content repo |
| `TABLINUM_GIT_BRANCH` | `main` | Branch to commit, pull and push |
| `TABLINUM_GIT_AUTHOR_NAME` | `tablinum` | Commit author name |
| `TABLINUM_GIT_AUTHOR_EMAIL` | `tablinum@localhost` | Commit author email |
| `TABLINUM_AUTOCOMMIT_MS` | `15000` | Quiet period a page must have before its edits are committed; `0` commits every write |
| `TABLINUM_COMMIT_MAX_HOLD_MS` | `120000` | Cap on that wait, so a page nobody stops editing still reaches git; `0` = no cap |
| `TABLINUM_AUTOPULL_MS` | `60000` | Background pull interval; `0` disables it |
| `TABLINUM_AUTOPUSH_MS` | `5000` | Quiet period after a commit before the push; `0` disables it |
| `TABLINUM_SLACK_BOT_TOKEN` | - | Slack bot token; unset turns mention notifications off |
| `TABLINUM_WEBHOOK_SECRET` | - | Signs every agent webhook, at least 16 characters; unset turns agent webhooks off |
| `TABLINUM_PUBLIC_URL` | - | Public origin, used for the link inside a notification |
| `TABLINUM_TRUST_PROXY` | `false` | Trust `X-Forwarded-Proto` and `X-Forwarded-For`. Turn it on behind a reverse proxy, or the session cookie never gets `Secure`. The Docker image defaults it to `true` |

## Contributing

`CONTRACT.md` is the frozen interface between the packages: the on-disk format, the shared types,
the REST API and the config. Read it before you change anything, and change it only with a matching
change in every package.
