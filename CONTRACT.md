# tablinum — FROZEN CONTRACT

Every package builds against this document. It is frozen: do not change it without a coordinated
update across all packages. If code and this file disagree, this file wins.

tablinum is a **standalone** self-hosted docs app. It has **no connection to Notion**: no import, no
API, no sync. It only borrows the *look and feel* of that style of block editor.

---

## MONOREPO LAYOUT (pnpm workspaces)

```
/Users/pmihaylov/prg/repos/tablinum/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, README.md, .env.example
  packages/shared/    @tablinum/shared   - types + zod schemas + config, zero deps beyond zod
  packages/core/      @tablinum/core     - content store (fs, frontmatter, page tree, id index)
  packages/git-sync/  @tablinum/git-sync - git engine
  packages/search/    @tablinum/search   - sqlite FTS5 index
  packages/accounts/  @tablinum/accounts - sqlite accounts: people, passwords, sessions, invites
  packages/mcp/       @tablinum/mcp      - MCP server: a stdio CLI and the remote endpoint's tools
  apps/server/        @tablinum/server   - Fastify REST API
  apps/web/           @tablinum/web      - React + Vite + TipTap
  deploy/                               - Dockerfile, docker-compose.yml, ops guide
```

## ON-DISK CONTENT FORMAT (source of truth for everything)

A content repo is a git repo. Default path: `${TABLINUM_CONTENT_DIR}`, fallback
`/Users/pmihaylov/prg/repos/tablinum/.data/content`

That directory is the DEFAULT WORKSPACE. Every other workspace is a git repo of its own with
exactly the same layout, one directory per workspace under `<parent of content dir>/workspaces/`.
See WORKSPACES below.

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
- An upload carries an allowed extension or it is refused: images, audio, video, `.pdf`, `.txt`,
  `.csv`, `.md`, `.json`, `.zip`. `.svg` and `.html` are not on the list, because both run script.
- `GET /_assets/*` answers with the type the extension names, or `application/octet-stream` plus
  `content-disposition: attachment`. Every attachment also gets `x-content-type-options: nosniff`
  and `content-security-policy: default-src 'none'; sandbox`, so a stored file never runs on this
  origin. Files uploaded before this rule are covered too, an old `.svg` included.

## STATE OUTSIDE THE CONTENT REPO

The SQLite files sit one level ABOVE `${TABLINUM_CONTENT_DIR}`, never inside it, because nothing
here may be committed or pushed to a remote.

```
<parent of content dir>/
  search.db        # FTS5 index of the default workspace. Derived: delete it and it rebuilds.
  accounts.db      # people, handles, password hashes, sessions, invites, avatar bytes,
                   # custom emoji bytes, Slack member ids, workspaces and their members,
                   # comment threads. NOT derived.
  workspaces/
    handbook/          # a second workspace: a git repo with the same layout as content/
    handbook.search.db # its FTS5 index, a sibling of the directory so the export never holds it
```

No path here is configurable. `accounts.db` is the only file in the whole system that a git
remote does not back up.

## WORKSPACES

A workspace is the top level, above spaces. It owns one git repository, so its spaces, pages,
attachments, search index, agents and live rooms are separate from every other workspace. Nothing
crosses a workspace except `accounts.db`: one person belongs to many workspaces, and a page id is
unique only inside the one that holds it.

- The workspace of `${TABLINUM_CONTENT_DIR}` is created on first start, named `Main`, slug `main`.
  It cannot be deleted, and it is the only one that uses `TABLINUM_GIT_REMOTE`.
- Every other workspace lives at `<parent of content dir>/workspaces/<slug>/` and is opened
  lazily, on the first request that names it. Its search index is `<that directory>.search.db`.
- A new workspace starts with one space, `general`, and its home page.
- MEMBERSHIP: `workspace_members` in `accounts.db`, role `admin` or `member`. Membership is never
  inferred: a person with no row anywhere reaches nothing, so removing somebody from their last
  workspace revokes access instead of moving them to another. Every path that makes an account
  writes the row: setup, an invite, and the back-fill for an install that predates workspaces. An
  install admin (`role: 'admin'`, or a bearer token) still reaches every workspace, and an agent
  token reaches exactly the one it was issued for.
- Removing a member destroys their sessions. A workspace admin may not remove themselves, and the
  last admin of a workspace may not be removed: both answer 409.
- Deleting a workspace forgets it and its members. The files stay on disk: export first.

WHICH WORKSPACE A REQUEST IS ABOUT, in order:

1. An agent token. It names one workspace and no header can point it at another.
2. `x-tablinum-workspace: <slug or id>`.
3. `?workspace=<slug or id>`, for links and for the WebSocket upgrade.
4. The `tablinum_workspace` cookie. An `<img>` inside a page sends nothing else. Not a credential.
5. Nothing: the caller's first workspace.

A named workspace the caller may not open answers `UNAUTHORIZED` for a signed-in person and
`NOT_FOUND` for anyone else, so neither answer says whether it exists.

EXPORT AND IMPORT: an export is a zip of the whole workspace directory, `.git` included, so every
page and its full history travel with it. The server commits what is pending before it packs.
An import unpacks the zip into a new directory, registers a new workspace and opens it, so the
same archive may be imported many times and gets a fresh slug each time. It keeps only the git
metadata that carries history (`.git/objects`, `.git/refs`, `HEAD`, `packed-refs`) and drops the
rest, config and hooks included, because git would run those as the server. Every extracted file
lands `0o644` and every directory `0o755`, whatever mode the archive claimed. Opening the imported
workspace rewrites the local git config, so the history survives the drop. A zip with one directory
at its top is unwrapped, so an archive made by another tool still works. Cap: 256 MB.

## FRONTMATTER

YAML, always present, always in this key order:

```yaml
---
id: pg_01J8XYZ...        # ULID-suffixed, stable, NEVER changes across renames/moves.
title: Deploy runbook    # required, string
icon: "🚀"               # optional, single emoji or ":shortcode:" for a custom one
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
Mentions are plain `@handle` text: nothing is encoded, so a page stays readable outside tablinum
and a rename never rewrites a page. A mention must start a word, so `mail@example.com` is an
address. A mention inside code names nobody.
Custom emoji are plain `:shortcode:` text for the same reason. The image is resolved when the
page is drawn, and only a shortcode somebody has uploaded is treated as one, so `10:30:45` stays a
time. No `<img>` is ever written into a page.
`![[page-path]]` alone on a line embeds that page; it counts as a link like any wikilink.
Videos are raw HTML: a one-line `<iframe>` or `<div class="gd-video"><video></video></div>`.

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
  rev: string;           // fingerprint of `markdown`; the unit of optimistic concurrency
  filePath: string;      // absolute path on disk
  hasChildren: boolean;
}

export type PageSummary = Omit<Page, 'markdown' | 'rev'>;

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
  dirtyFiles: string[]; remote: string | null; lastCommit: Revision | null;   // remote: no user:password
  conflict: GitConflict | null;   // set while a pull is blocked on a rebase it cannot finish
}

export interface GitConflict { files: string[]; message: string; at: string; }

/** One conflicted file, with every version the resolution UI needs. */
export interface ConflictFile {
  file: string;                   // repo-relative
  path: PagePath | null;          // the page it holds, when it holds one
  title: string | null;
  local: string; remote: string; base: string;
  merged: string;                 // three-way merge, with markers when it is not clean
  clean: boolean;
}

export interface Backlink { id: PageId; path: PagePath; title: string; }
```

`packages/shared/src/accounts.ts` — accounts, invites and their request bodies:

```ts
export type AccountRole = 'admin' | 'member';   // admin invites people and edits the roster

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_AVATAR_BYTES = 512 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const DEFAULT_INVITE_DAYS = 14;

export interface Account {
  id: string;             // "us_" + ULID
  email: string;
  name: string;
  handle: string;         // the `@handle` used to mention this person. Set once, NEVER changes.
  role: AccountRole;
  color: string;          // derived from the id, so presence matches in every browser
  avatarRev: string | null;  // changes on every upload; null means "draw the initials"
  disabled: boolean;
  created: string; updated: string;   // ISO
}

export interface Invite {
  id: string;             // "iv_" + ULID
  email: string | null;   // set = pinned to one address; null = anyone with the link
  role: AccountRole;
  workspaceId: string | null;   // the workspace the new account joins; null before workspaces
  createdBy: string | null;
  created: string; expires: string;   // ISO
  acceptedBy: string | null;
  accepted: string | null;
  revoked: boolean;
}

// A password hash, a session token and the avatar bytes NEVER leave the server.
```

Helpers in the same file: `avatarUrl(id, rev)` -> `/api/v1/users/<id>/avatar?v=<rev>` for a
person and `/api/v1/agents/<id>/avatar?v=<rev>` for an agent, because both have a picture and
their ids never collide. Also `inviteUrl(origin, token)` -> `<origin>/invite/<token>`,
`initialsOf(name)`, `colorForId(id)`.

`packages/shared/src/agents.ts` — agents, the non-human writers:

```ts
export const AGENT_ID_PREFIX = 'ag_';
export const AGENT_TOKEN_PREFIX = 'gda_';   // the prefix routes a token without a db lookup
export const MCP_ENDPOINT = '/api/v1/mcp';
export const MAX_IDENTITY_LENGTH = 4000;

export interface Agent {
  id: string;             // "ag_" + ULID
  workspaceId: string;    // the one workspace this agent writes to
  name: string;
  handle: string;         // one namespace with the people, so `@handle` names exactly one writer
  identity: string;       // the brief the MCP server hands back as its instructions. May be ''.
  color: string;          // derived from the id, so it looks the same in every browser
  avatarRev: string | null;  // changes on every upload; null means "draw the initials"
  created: string; updated: string;
  lastUsed: string | null;   // refreshed at most once a minute
}

// An agent has no active or paused state. Deleting it is what stops it, and its token dies
// with it, so there is nothing switched off that still holds a working credential.

// The token itself is stored hashed and is readable ONLY in the response that issues it.
```

Helper in the same file: `mcpUrl(origin)` -> `<origin>/api/v1/mcp`.

`packages/shared/src/emoji.ts` holds custom emoji, the images anybody may upload:

```ts
export const CUSTOM_EMOJI_ID_PREFIX = 'ce_';
export const MAX_SHORTCODE_LENGTH = 32;
export const MAX_CUSTOM_EMOJI_BYTES = 256 * 1024;
export const CUSTOM_EMOJI_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const SHORTCODE_PATTERN = '[a-z0-9_-]+';

export interface CustomEmoji {
  id: string;             // "ce_" + ULID
  shortcode: string;      // lower case, unique across the install, written as `:shortcode:`
  mime: string;           // the type the server sniffed from the bytes, never the declared one
  userId: string;         // who uploaded it. Only that person and an admin may delete it.
  created: string;        // ISO
}

// The image bytes live in `accounts.db` and NEVER in the content repo.
```

Helpers in the same file: `customEmojiUrl(shortcode)` -> `/api/v1/emoji/<shortcode>/image`,
`shortcodeToken(shortcode)` -> `:shortcode:`, `shortcodeOf(icon)`, `sniffImageMime(bytes)`,
`isShortcode(value)`, `newCustomEmojiId()`, `isCustomEmojiId(value)`.

`packages/shared/src/workspaces.ts` — the top level:

```ts
export const WORKSPACE_ID_PREFIX = 'ws_';
export const WORKSPACE_HEADER = 'x-tablinum-workspace';
export const WORKSPACE_QUERY = 'workspace';
export const WORKSPACE_COOKIE = 'tablinum_workspace';
export const DEFAULT_WORKSPACE_SLUG = 'main';
export const DEFAULT_WORKSPACE_NAME = 'Main';
export const MAX_WORKSPACE_SLUG_LENGTH = 40;

export type WorkspaceRole = AccountRole;   // admin renames, adds people and deletes

export interface Workspace {
  id: string;             // "ws_" + ULID
  slug: string;           // lower case, a directory name and a header value
  name: string;
  icon?: string;
  created: string; updated: string;   // ISO
}

export interface WorkspaceMember { account: Account; role: WorkspaceRole }

// The directory a workspace lives in is a server detail and never leaves the process.
```

Helpers in the same file: `workspaceSlugOf(name)`, `workspaceExportName(slug)` -> `<slug>.zip`,
`newWorkspaceId()`, `isWorkspaceId(value)`.

`packages/shared/src/comments.ts` holds the conversation about a page, never the page itself:

```ts
export const THREAD_ID_PREFIX = 'ct_';
export const COMMENT_ID_PREFIX = 'cm_';
export const MAX_COMMENT_LENGTH = 5000;
export const MAX_QUOTE_LENGTH = 300;
export const ANCHOR_CONTEXT_LENGTH = 40;   // context kept on each side of the quote

/** Where a thread sits in the page, as text. A W3C TextQuoteSelector, near enough. */
export interface CommentAnchor {
  quote: string;          // the selected text, cut at MAX_QUOTE_LENGTH
  prefix: string; suffix: string;   // enough to tell two identical quotes apart
  start: number;          // offset it was taken from. A hint for picking the nearest match only.
}

export interface Comment {
  id: string;             // "cm_" + ULID
  threadId: string;
  author: string;         // an account id. Agents and API tokens read comments, never write one.
  body: string;           // CommonMark, rendered with raw HTML OFF
  created: string; updated: string;   // ISO; equal until the author edits it
}

export interface CommentThread {
  id: string;             // "ct_" + ULID
  pageId: PageId;
  anchor: CommentAnchor | null;   // null = a comment about the whole page
  resolved: boolean;
  resolvedBy: string | null; resolvedAt: string | null;
  created: string; updated: string;   // ISO
  comments: Comment[];    // the opening comment first, then the replies in order. Never empty.
}
```

Helper in the same file: `unresolvedCount(threads)`, the number the comments button shows.

`packages/shared/src/editing.ts` — how an agent addresses the text of a page:

```ts
/** A top-level markdown block: a run of lines with a blank line on each side. */
export interface Block { index: number; start: number; end: number; text: string }

/** A point in the markdown, counted the way a person reads it. */
export interface Cursor { block: number; offset: number }

/** Two points. Equal ends are a plain caret; different ends are a selection. */
export interface Span { anchor: Cursor; head: Cursor }

/** A caret the server is holding for one credential. */
export interface CursorState { pageId: PageId; path: PagePath; anchor: Cursor; head: Cursor; updated: string }
```

A blank line inside a fenced code block separates nothing, and a fence is closed only by its own
kind, so a code block is always one block. Block indexes line up with the top-level nodes of the
editor's document, which is what lets a browser draw an agent's caret. Helpers in the same file:
`splitBlocks`, `clampCursor`, `offsetOf`, `cursorAt`, `spanOffsets`, `spanText`, `collapsed`,
`splice`, `findAll`, `wholePage`.

COMMENTS ARE NOT PAGE CONTENT. Bodies live in `accounts.db`, keyed by workspace and page id, so a
markdown file read on a git remote carries no comment id, no highlight span and no discussion. The
browser looks the `quote` up again in the document on every load and draws the highlight as a
ProseMirror decoration, which is never serialized. A quote the page no longer holds makes the
thread ORPHANED: it stays readable in the panel with its quote shown, and loses its highlight.
Nothing is guessed and no fuzzy match is tried, so a comment can never point at a sentence it was
not written about.

## REST API

`apps/server`, all under `/api/v1`, JSON in/out.

Three credentials, all granting the same access to the content:

1. An account: an email and a password, exchanged for a session cookie. This one names a person.
2. `Authorization: Bearer <token>`, with tokens from env `TABLINUM_API_TOKENS`. Names nobody.
3. `Authorization: Bearer gda_<token>`, issued per agent. This one names an agent, never an admin.

The cookie is `tablinum_session`, signed and httpOnly. Its payload starts with `u1.`. Sessions last
30 days.

EVERY BROWSER SESSION NAMES AN ACCOUNT. There is no shared password and no open mode: a bearer
token is a machine credential and never reaches the web UI. A server with no account yet is
unclaimed, so `POST /api/v1/auth/setup` is public and the first visitor becomes the admin. That
route refuses every later call. `role: 'admin'` is required for the roster and invite endpoints;
everything else is open to any credential.

Every content endpoint answers about ONE workspace, chosen as WORKSPACES above describes. A client
that names none gets its first workspace, which is what a single-workspace install always sees.

A comment endpoint takes its workspace the same way and every comment query filters on that id, so
a thread in one workspace stays unreachable from another even when somebody knows its id. A page in
another workspace answers `NOT_FOUND`, exactly as the page endpoints do. Writing a comment needs an
account: an agent token and an API token read comments but author none, because a comment names a
person. Deleting a page deletes its threads.

Every response carries `x-content-type-options: nosniff` and `referrer-policy: same-origin`. An
HTML document also carries a `content-security-policy` with `script-src 'self'`, so the web app
holds no inline script: the theme is painted by `apps/web/public/theme.js`. The policy keeps
`style-src 'unsafe-inline'` for the editor's style attributes, and `frame-src https:` for the
video players in `apps/web/src/editor/embeds.ts`.

```
GET    /api/v1/health                          (public) -> { ok: true }
                                               with any credential -> { ok: true, version, contentDir }
POST   /api/v1/auth/login                      body { email, password } -> cookie, { ok: true, user: Account }
POST   /api/v1/auth/logout                     -> { ok: true }
GET    /api/v1/auth/state                      (public) -> { setupRequired, user: Account | null }
POST   /api/v1/auth/setup                      (public) body { email, name, password }
                                               -> { ok: true, user: Account }
                                               (409 once any account exists; makes the first admin
                                                and adds them to the default workspace)
GET    /api/v1/auth/invite/:token              (public) -> { email: string | null, role, expires, invitedBy }
POST   /api/v1/auth/register                   (public) body { token, email?, name, password }
                                               -> { ok: true, user: Account }
                                               (email is ignored when the invite is pinned)

GET    /api/v1/me                              -> { user: Account | null }   (null for a bearer token)
PATCH  /api/v1/me                              body { name?, color? } -> { user: Account }
POST   /api/v1/me/password                     body { current, next } -> { ok: true }
                                               (signs every other session out, keeps this one)
POST   /api/v1/me/avatar                       multipart field `file` -> { url, rev }
DELETE /api/v1/me/avatar                       -> { ok: true }
GET    /api/v1/me/slack                        -> { configured, connected, slackUserId: string | null }
POST   /api/v1/me/slack                        body { slackUserId? } -> the same state
                                               (no id = look the address up in Slack; 409 without a
                                                bot token; 404 when Slack knows no such address)
DELETE /api/v1/me/slack                        -> the same state, disconnected

GET    /api/v1/users                           account only -> { users: Account[] }
                                               (an admin reads the install, everybody else reads
                                                the people in this workspace)
GET    /api/v1/users/:id/avatar                ?v=<rev> -> the image bytes, immutable cache, 404 when none
PATCH  /api/v1/users/:id                       admin, body { name?, role?, disabled? } -> { user: Account }
DELETE /api/v1/users/:id                       admin -> { ok: true }   (409 on yourself)

GET    /api/v1/invites                         admin -> { invites: Invite[] }
POST   /api/v1/invites                         admin, body { email?, role?, expiresInDays? }
                                               -> { invite: Invite, url }   (the token appears once)
DELETE /api/v1/invites/:id                     admin -> { ok: true }

GET    /api/v1/agents                          admin -> { agents: Agent[] }
POST   /api/v1/agents                          admin, body { name, identity?, handle? }
                                               -> { agent: Agent, token, url }  (token appears once)
PATCH  /api/v1/agents/:id                      admin, body { name?, identity? }
                                               -> { agent: Agent }   (the handle never changes)
DELETE /api/v1/agents/:id                      admin -> { ok: true }
POST   /api/v1/agents/:id/token                admin -> { agent, token, url }
                                               (the old token stops working at once)
GET    /api/v1/agents/:id/avatar               ?v=<rev> -> the image bytes, immutable cache, 404 when none
POST   /api/v1/agents/:id/avatar               admin, multipart field `file` -> { url, rev }
DELETE /api/v1/agents/:id/avatar               admin -> { ok: true }

GET    /api/v1/emoji                           -> { emoji: CustomEmoji[] }   (oldest first)
POST   /api/v1/emoji                           account, multipart field `shortcode` + field `file`
                                               -> { emoji: CustomEmoji }
                                               (409 when the shortcode is taken; 400 on a bad name,
                                                a file over 256 KB, or bytes that are not
                                                png/jpeg/webp/gif)
GET    /api/v1/emoji/:shortcode/image          -> the image bytes, private cache, 404 when none
DELETE /api/v1/emoji/:id                       account -> { ok: true }
                                               (the uploader or an admin; 401 for anybody else)

GET    /api/v1/workspaces                      -> { workspaces: Workspace[], current: <slug> }
                                               (only the ones this caller may open)
POST   /api/v1/workspaces                      admin, body { name, slug?, icon? }
                                               -> 201 { workspace: Workspace }
                                               (makes the directory, a "general" space and its home page;
                                                the caller becomes an admin of it)
PATCH  /api/v1/workspaces/:id                  workspace admin, body { name?, slug?, icon? }
                                               -> { workspace: Workspace }   (icon: null clears it)
DELETE /api/v1/workspaces/:id                  admin -> { ok: true }
                                               (400 on the workspace the server was started with and
                                                on the last one; the files stay on disk)
GET    /api/v1/workspaces/:id/members          account only -> { members: WorkspaceMember[] }
POST   /api/v1/workspaces/:id/members          workspace admin, body { userId, role? } -> { ok: true }
PATCH  /api/v1/workspaces/:id/members/:userId  workspace admin, body { role } -> { ok: true }
DELETE /api/v1/workspaces/:id/members/:userId  workspace admin -> { ok: true }
                                               (409 on yourself and on the last admin; the removed
                                                person's sessions are destroyed)
GET    /api/v1/workspaces/:id/export           workspace admin -> the zip bytes, `application/zip`,
                                               `content-disposition: attachment; filename="<slug>.zip"`
                                               (it commits first, so `sec-fetch-site: cross-site`
                                                answers 401: open the link from the app itself)
POST   /api/v1/workspaces/import               admin, multipart file + optional field `name`
                                               (or ?name=) -> 201 { workspace: Workspace }
                                               (name falls back to the file name; the slug is always free)

GET    /api/v1/spaces                          -> { spaces: Space[] }
POST   /api/v1/spaces                          body { slug, name, icon? } -> { space: Space }
                                               (also writes the space home page, so the space opens at once)
PATCH  /api/v1/spaces/:slug                    body { name?, icon?, order? } -> { space: Space }
                                               (icon: null clears it; the slug never changes)

GET    /api/v1/tree                            -> { spaces: Array<Space & { tree: TreeNode[] }> }
GET    /api/v1/pages                           ?path=<PagePath> -> { page: Page }
                                               (no query) -> { pages: PageSummary[] }  (all, flat)
GET    /api/v1/pages/:id                       -> { page: Page }
POST   /api/v1/pages                           body { path, title, markdown?, icon?, tags?, props?, order? }
                                               -> 201 { page: Page }
PATCH  /api/v1/pages/:id                       body { title?, markdown?, icon?, tags?, props?, order?, path?, baseRev? }
                                               (path = move/rename, across spaces too) -> { page: Page }
                                               (baseRev + markdown that lost the race -> 409 CONFLICT,
                                                error.info = { markdown, rev, updated })
DELETE /api/v1/pages/:id                       ?recursive=true -> { deleted: PagePath[] }

GET    /api/v1/pages/:id/cursor                -> { cursor: CursorState | null }
PUT    /api/v1/pages/:id/cursor                body { anchor: Cursor, head?: Cursor }
                                               -> { cursor: CursorState }
                                               (one caret per credential per page; the server clamps
                                                it onto text that exists and forgets it after 30 min)

GET    /api/v1/search                          ?q=&space=&tag=&limit= -> { hits: SearchHit[] }
GET    /api/v1/pages/:id/backlinks             -> { backlinks: Backlink[] }
GET    /api/v1/pages/:id/history               ?limit= -> { revisions: Revision[] }
GET    /api/v1/pages/:id/revisions/:sha        -> { markdown, frontmatter: Frontmatter }

GET    /api/v1/pages/:id/comments              ?resolved=true|false -> { threads: CommentThread[] }
                                               (no query = every thread, oldest first)
POST   /api/v1/pages/:id/comments              body { body, anchor? } -> 201 { thread: CommentThread }
                                               (no anchor = a comment about the whole page)
POST   /api/v1/comment-threads/:id/replies     body { body } -> 201 { thread: CommentThread }
PATCH  /api/v1/comment-threads/:id             body { resolved } -> { thread: CommentThread }
                                               (anybody in the workspace may resolve or reopen)
PATCH  /api/v1/comments/:id                    body { body } -> { thread: CommentThread }
                                               (the author only, admin included: nobody rewords
                                                somebody else's remark)
DELETE /api/v1/comments/:id                    -> { thread: CommentThread | null }
                                               (the author or an admin; deleting the opening
                                                comment takes the thread with it and answers null)

GET    /api/v1/views                           ?dir=<PagePath>&where=<k:v,k:v>&sort=<key>&order=asc|desc
                                               -> { columns: string[], rows: PageSummary[] }
                                               (a table over child pages' frontmatter props)

GET    /api/v1/git/status                      -> { status: GitStatus }
POST   /api/v1/git/pull                        -> { status: GitStatus, pulled: number }
POST   /api/v1/git/push                        -> { status: GitStatus, pushed: boolean }
POST   /api/v1/git/commit                      body { message? } -> { sha: string | null }
                                               (a message is at most 2000 chars and carries no
                                                control bytes: the git log is parsed on those)
GET    /api/v1/git/conflict                    -> { conflict: GitConflict | null, files: ConflictFile[] }
POST   /api/v1/git/resolve                     workspace admin, body { files: Array<{ file, content }>,
                                               message? } -> { status: GitStatus, resolved: string[] }
                                               (each `file` is repo-relative, never under `.git`, and
                                                must be one git itself reported as conflicted)

POST   /api/v1/assets                          multipart -> { url, path }

POST   /api/v1/mcp                             the remote MCP endpoint (see below)

GET    /api/v1/live                            WebSocket upgrade, ?client=<tab id>&workspace=<slug>
```

## REMOTE MCP

`POST /api/v1/mcp` speaks MCP over HTTP, so an agent needs no local process. It is stateless:
`sessionIdGenerator` is undefined and `enableJsonResponse` is on, so every request stands alone,
carries its own credential and survives a restart. A `GET` answers 405, because a stateless server
pushes nothing.

The tools are the same ones `packages/mcp` exposes over stdio. The endpoint reaches them through a
loopback `fetch` built on `app.inject()`, so the MCP tools go through the REST layer and get the
same validation, indexing and git commits as the editor. The caller's `authorization` and `cookie`
headers travel with each loopback call, so an agent gets exactly the authority the auth hook
already granted it, and never more.

When the credential is an agent token, the handshake `instructions` start with that agent's brief:
its name, its `@handle` and its `identity`. Every other credential gets the shared tool guidance
alone.

A client must send `content-type: application/json` and accept both `application/json` and
`text/event-stream`, as the MCP spec requires.

## LIVE CHANNEL

One WebSocket per browser tab, at `/api/v1/live`. The tab id travels as `?client=` on the
upgrade and as the `x-tablinum-client` header on every REST call, because a browser cannot set
a header on an upgrade. The id is a proposal: the `welcome` frame names the id the server kept,
and a tab asking for an id another person holds is given a fresh one instead of taking it over. `?workspace=` travels with it for the same reason. A broadcast reaches
every tab in THAT workspace, the originator included; `by` names the tab that caused it, so that
tab ignores its own echo. Each workspace has its own hub and its own rooms.

```ts
// A LiveUser is always the signed-in Account: a tab reaches the live channel only once it has one.
interface LiveUser { id: string; name: string; color: string }

// An agent works over MCP and holds no socket, so the server seats it and expires it itself.
interface LiveAgent { id: string; name: string; handle: string; avatarRev: string | null }

// client -> server
type ClientMessage =
  | { type: 'hello'; user: LiveUser }              // sent again after a sign-in, without a reconnect
                                                  // the `user` is ignored: the credential names the
                                                  // tab, so a machine credential shows no chip
  | { type: 'watch'; path: PagePath | null }
  | { type: 'editing'; editing: boolean }
  | { type: 'ping' }
  | { type: 'doc-open'; path: PagePath }
  | { type: 'doc-close'; path: PagePath }
  | { type: 'doc-steps'; path: PagePath; version: number; steps: unknown[] }
  | { type: 'doc-caret'; path: PagePath; anchor: number; head: number }
  | { type: 'doc-baseline'; path: PagePath; version: number;
      markdown: string; title: string; rev: string };

// server -> client
type ServerMessage =
  | { type: 'welcome'; clientId: string }
  | { type: 'page'; id: PageId; path: PagePath; title: string; rev: string;
      by: string | null; agent: LiveAgent | null; source: 'api' | 'disk' | 'pull' }
  | { type: 'removed'; paths: PagePath[] }
  | { type: 'presence'; path: PagePath;
      users: Array<LiveUser & { editing: boolean; agent: LiveAgent | null }> }
  | { type: 'git'; status: GitStatus }
  | { type: 'comments'; pageId: PageId; by: string | null }   // threads changed, read them again
  | { type: 'pong' }
  | { type: 'doc-init'; path: PagePath; baseline: { markdown, title, rev };
      baseVersion: number; steps: DocStep[]; writer: string | null }
  | { type: 'doc-steps'; path: PagePath; version: number; steps: DocStep[] }
  | { type: 'doc-caret'; path: PagePath; client: string; user: LiveUser;
      anchor: number; head: number }
  | { type: 'doc-agent-caret'; path: PagePath; client: string; user: LiveUser;
      agent: LiveAgent; anchor: Cursor; head: Cursor }   // blocks and offsets, not positions
  | { type: 'doc-writer'; path: PagePath; writer: string | null }
  | { type: 'doc-reset'; path: PagePath; reason: 'disk' | 'overflow' | 'gone' }
  | { type: 'doc-left'; path: PagePath; client: string };

interface DocStep { step: unknown; client: string }   // a ProseMirror step, never inspected
```

A tab pings every 20s. The server drops a socket after three missed heartbeats.

AGENTS ON A PAGE: an agent has no socket, so the REST layer seats it. Every page read or write
made with an agent token puts that agent on the page it touched, and takes it off the page it was
on before. A write also sets `editing`, which makes the chip pulse. One agent holds one seat. The
seat lapses `AGENT_PRESENCE_MS` (60s) after the last tool call and the sweep announces the empty
page; deleting the agent takes the seat away at once. An agent that moves its caret also gets one
drawn on every open tab: it travels as `doc-agent-caret` in blocks and offsets, because an agent
has never seen the tab's document, and the tab turns it into a position of its own. The caret goes
away with the seat, as a `doc-left`. A write by an agent also names it in the
`page` broadcast, so an open tab pulls the new bytes and says who wrote them.

COLLABORATION: one room per open page. The server orders steps and relays them; it never reads
inside a step, so it needs no schema. A step is accepted only at the head of the room
(`version = baseVersion + steps.length`); a stale submission is dropped in silence and the sender
rebases. One member is the `writer` and is the only tab that saves the file. The room compacts its
log on every save and resets rather than grow past `MAX_ROOM_STEPS`.

ERRORS: always `{ error: { code: string, message: string } }` with a proper HTTP status.
Codes: `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `UNAUTHORIZED`, `GIT_ERROR`, `INTERNAL`

## CONFIG

Read from env, all packages use `@tablinum/shared`'s `loadConfig()`:

| Variable | Default |
| --- | --- |
| `TABLINUM_CONTENT_DIR` | `/Users/pmihaylov/prg/repos/tablinum/.data/content` |
| `TABLINUM_PORT` | `4000` |
| `TABLINUM_API_TOKENS` | comma-separated bearer tokens |
| `TABLINUM_SESSION_SECRET` | cookie signing secret |
| `TABLINUM_GIT_REMOTE` | optional git remote URL |
| `TABLINUM_GIT_BRANCH` | `main` |
| `TABLINUM_GIT_AUTHOR_NAME` | `tablinum` |
| `TABLINUM_GIT_AUTHOR_EMAIL` | `tablinum@localhost` |
| `TABLINUM_AUTOCOMMIT_MS` | quiet period before the edits are committed, default `15000` |
| `TABLINUM_COMMIT_MAX_HOLD_MS` | cap on that wait, default `120000`, `0` = no cap |
| `TABLINUM_AUTOPULL_MS` | periodic pull interval, default `60000`, `0` = off |
| `TABLINUM_AUTOPUSH_MS` | quiet period after a commit before the push, default `5000`, `0` = off |
| `TABLINUM_SLACK_BOT_TOKEN` | Slack bot token. Unset turns mention notifications off |
| `TABLINUM_PUBLIC_URL` | origin used in a notification link, e.g. `https://docs.example.com` |
| `TABLINUM_TRUST_PROXY` | trust `X-Forwarded-*`, default `false`. Behind a TLS-terminating proxy this is what marks the session cookie `Secure` and gives the login throttle a real client address. The Docker image defaults it to `true` |
