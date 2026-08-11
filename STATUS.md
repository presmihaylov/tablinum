# tablinum — integration status

Last verified: 2026-08-11, Node 22.22.3, pnpm 10.9.0, macOS (darwin 23.6.0).

tablinum is a standalone, self-hosted docs app. Every page is a markdown file with YAML
frontmatter in a git repo. Humans edit through the web block editor; agents edit through the
REST API, the MCP server (stdio or remote), or the files themselves.

---

## Gate results

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm -r typecheck` | PASS — 8 projects, strict + `noUncheckedIndexedAccess`, 0 errors |
| Build | `pnpm -r build` | PASS — 8 dist outputs, Vite bundle 1,284 kB (410 kB gzip) |
| Test | `pnpm -r test` | PASS — 0 failures across 8 packages |
| End to end | `pnpm e2e` | PASS — 0 failures |

Run `pnpm test:count` for the per-package and total test counts. They are generated, not recorded
here: every branch bumped the same two lines, so every pair of open PRs conflicted on them and one
merge landed a wrong total.

`packages/git-sync` cleans a temp repo at the end of every case and occasionally loses a race with
git's own file handles (`ENOTEMPTY ... rmdir .git`). It passes on a re-run. It is a test-teardown
flake, not a product fault.

---

## What works end to end (verified against a live server)

The demo content was seeded into a temp directory, the built server ran on port 4177 with a
real bearer token and a real admin account, and every line below is a captured command output.

### REST API

- `GET /health` → `{"ok":true,"version":"0.1.0","contentDir":"..."}`.
- Auth is enforced. No token and a wrong token both give
  `UNAUTHORIZED: Missing or invalid credentials`. `POST /auth/login` with an email and a password
  sets a session cookie, and that cookie then authorises `GET /spaces`. A wrong password gives
  `UNAUTHORIZED: That email and password did not match`.
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
- Driven in a real browser earlier in the project: the login screen accepts the account, the app
  renders the sidebar tree, space switcher, search, the block editor, the properties panel, tags,
  backlinks and history, and typing autosaves to disk and to git. This browser pass was **not**
  repeated in the final verification run; the two HTTP checks above were.
- The page icon sits above the title and is editable. A click on it opens a wide emoji picker,
  and the picked emoji is written to the frontmatter through the same debounced save as the text.
  A page with no icon offers "Add icon" on hover, and a page with one offers "Remove".
- The `/page` slash command both embeds an existing page and creates a new one. The new page is
  made as a child of the open page and the embed is inserted for it.
- Both of the two bullets above are covered by `apps/web/test/editor/pageEditor.test.tsx` and
  `apps/web/test/editor/pagePicker.test.tsx`, not by a browser pass.
- A right-click on a page in the sidebar offers "Move to space". The dialog lists every other
  space, and the choice sends one PATCH that moves the page, and its subtree, to the top level of
  that space. The page that moved is then opened, so the move is always visible. The item is
  hidden on a space home page, which cannot move.
  Covered by `apps/web/test/pageTree.test.tsx` and `apps/web/test/treeMove.test.ts`.
- The space switcher creates and edits a space through one dialog: a name field plus an emoji
  grid. A new space is opened as soon as it is made, because the server gives every space a home
  page. "Edit space" renames the open space and sets or clears its icon through
  `PATCH /api/v1/spaces/:slug`. Covered by `apps/web/test/spaces.test.tsx`.

### Live collaboration

- Each browser tab holds one WebSocket at `/api/v1/live`. The hub broadcasts a page change to
  every tab, whatever caused it: an API save, a file written on disk, or a `git pull`.
- A save carries `baseRev`. A save built on a stale revision returns 409 with the current copy,
  and the browser merges the two edits with a three-way merge and saves again.
- Edits on different lines merge with no prompt. Edits on the same lines open a dialog with the
  marked-up merge, the local version and the remote version, and a diff between them.
- A pull that git cannot rebase surfaces as a conflict button in the sidebar. `GET /git/conflict`
  returns the three versions of each file plus an automatic merge; `POST /git/resolve` writes the
  chosen text, commits it, reindexes and tells every tab.
Verified two ways. The unit and route suites cover the pieces (`apps/server/test/live.test.ts`,
`apps/server/test/git-conflict.test.ts`, `apps/web/test/livedoc.test.ts`,
`apps/web/test/liveClient.test.ts`). A second run drove the built server with two real
WebSocket clients and captured all 20 checks green:

- A welcome frame reaches both tabs, and a page created by tab A is announced to both, stamped
  `by: tab-a`, `source: api`.
- Both people appear in `presence` with their names, and tab B's editing flag reaches tab A.
- Two saves from the same `baseRev`: the first returns 200, the second returns 409 carrying the
  winner's markdown. A three-way merge of the two edits is clean, and the retry against the
  returned `rev` lands both edits (`one/two/three` + `ONE/…/…` + `…/…/THREE` = `ONE two THREE`).
- A file written straight into the repo reaches the tabs as `source: disk`.
- A save with no `baseRev` wins unconditionally, which is the path agents take.
- Auto-commit produced real commits, `GET /git/status` reported no conflict, and
  `GET /git/conflict` was quiet on the clean repo.
- Closing tab B removed that person from the presence list on tab A.

This was **not** a two-browser session, so the editor's caret handling on an adopted `incoming`
change is still only covered by unit tests.

### Keystroke streaming and remote carets

Two tabs on the same page share one live document. Every keystroke travels as a ProseMirror step,
and each person's caret and selection are drawn in the others' editors with a name tag.

The server is a **schema-free authority**. It puts steps in an order and hands that order to
everyone; it never parses one. The ProseMirror schema therefore stays in the browser, and
markdown stays the only thing on disk. There is no CRDT state to persist, so the git repo is
still the whole truth.

- **Room.** `{ baseline: {markdown,title,rev}, baseVersion, steps[], members[] }`, one per open
  page. `version = baseVersion + steps.length`. Steps are accepted only at the head of the room,
  so two tabs that type in the same instant cannot interleave: the slower one rebases against the
  batch it is about to receive and sends again. A stale batch is answered with silence.
- **Writer election.** `members[0]` is the writer. It is the only tab that PATCHes the page; the
  others hold their text and would only save the same bytes over the top. When the writer leaves,
  the next tab in join order is told it has the pen and saves what it was holding.
- **Log compaction.** After a save lands, the writer sends `doc-baseline`. The server accepts it
  only from the writer, only at the head of the room, and the writer only sends it while the text
  on screen is byte-identical to the text the server confirmed. `MAX_ROOM_STEPS = 400` is the
  backstop; overflow throws the room away and every tab rejoins.
- **Reset.** A page that changes underneath the room resets it, unless the change is the writer
  saving its own work. On a reset each tab rejoins, and the **writer only** three-way merges its
  on-screen text into the new baseline. A merge that clashes keeps the local text, whose save
  409s into the conflict dialog that already exists.
- **Carets.** Positions are mapped through every transaction, so a caret keeps its place while
  the text around it moves. The name tag shows for 1.6 s after a move and on hover.

Verified three ways.

- 27 server tests (`apps/server/test/docroom.test.ts`) cover the pure authority and the hub
  wiring: join order, writer hand-off, stale and overflow submissions, compaction refused from a
  non-writer and refused behind the head, resets from disk, from a foreign save, from a delete.
- 15 web tests (`apps/web/test/editor/streaming.test.ts`, `apps/web/test/editor/carets.test.ts`)
  drive **real TipTap editors with the real schema** through the **real server authority**. Two
  people typing in the same paragraph on the same version converge byte-for-byte, and a document
  with a heading, a list, a GFM table and a fenced block still round-trips after a streamed edit.
- A live run against the built server with two real WebSocket clients captured **34/34** checks
  green: baselines, ordering, sender echo, stale silence, caret relay with the sender excluded,
  compaction accepted from the writer and refused from the other tab, `disk`/`gone` resets, the
  pen handed on, and a malformed frame ignored without closing the socket.

Still not verified by a two-browser session: how the carets look while someone types.

### The first run

A fresh server has no account, so nobody can reach the API and nobody can authorise the first
person. `POST /auth/setup` is public exactly while `accounts.isEmpty()` holds. The web sign-in
screen asks for an email, a name and a password, then keeps the same card and asks the new admin
to name the workspace the server started with. That second step PATCHes the default workspace
name and slug, and a "Skip for now" button leaves the default name in place.

Captured against the built server on port 4187, with no API token set:

```
boot warning        No account exists yet. Open http://localhost:4187 to create the first one.
GET  /auth/state    {"setupRequired":true,"user":null}
GET  /tree          401
POST /auth/setup    200, role "admin", session cookie set
GET  /auth/state    {"setupRequired":false,"user":{...,"role":"admin"}}
GET  /workspaces    one workspace, slug "main"
PATCH /workspaces   {"workspace":{...,"slug":"acme-docs","name":"Acme Docs"}}
POST /auth/setup    409  (the second call)
POST /auth/login    400  with {"password":...} alone, 200 with the email
GET  /tree          200  with the login cookie
```

### Accounts, invites and avatars

`packages/accounts` is a second SQLite database, `accounts.db`, beside `search.db` and one level
above the content root. It holds people, password hashes, session tokens, invites and avatar
bytes. **None of it is in the git repo**, so a push never carries a password or a picture.

`AccountStore.#migrate()` runs on every boot. Every statement in it is idempotent:
`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `addColumn()`, which checks
`table_info` first. **A new column needs an `addColumn()` call, not just a line in the
`CREATE TABLE` block**, because an existing file never re-runs that block. `user_version` is only
a stamp for a future destructive migration; it no longer gates anything. It used to, and a column
added without a version bump then reached fresh installs only. `packages/accounts/test/migrate.test.ts`
holds the line: it ages a real file and checks the column comes back.

- **Passwords** are scrypt with a per-password salt, stored as `scrypt$N$r$p$salt$hash`. The
  minimum length is 10 characters. Comparison is constant time.
- **Sessions** are random tokens in a table, cookie `tablinum_session`, 30 days. A signed-out
  token is deleted, so a copied cookie dies with it. A password reset drops every session for
  that account.
- **Invites** are random tokens with an expiry (14 days by default) and an optional pinned email.
  `GET /auth/invite/:token` is the one public account endpoint, because an invited person has no
  credential yet. Redeeming one is throttled exactly like a password.
- **Avatars** are PNG, JPEG, WebP or GIF blobs up to 512 kB, served from
  `/users/:id/avatar?v=<rev>` with a long cache lifetime. The rev changes on every upload.

Three credentials now reach the same API: an account cookie, an API bearer token and an agent
token. **Every browser session names an account.** A bearer token is a machine credential, so
there is no shared password and no open mode. An agent token is the one credential that is
deliberately never an admin.

Bootstrap needs no environment variable. `POST /auth/setup` is public while the server has no
account, so the first visitor creates the admin, joins the workspace the server started with and
names it. The route refuses every later call, which closes the server for good.

Roles are `admin` and `member`. An admin invites people, changes roles and removes accounts; the
store refuses to demote or delete the last admin. Everybody signed in may read the roster,
because the UI names the author of every edit.

Verified by tests, not by a live browser session:

- 38 store tests (`packages/accounts/test`) cover hashing, sessions, invites, avatars and the
  last-admin rules.
- 16 route tests (`apps/server/test/accounts.test.ts`) cover setup, login, register, the three
  credential kinds, admin gating and the avatar endpoints.
- 29 web tests (`apps/web/test/accounts.test.tsx`) cover the gate in front of the shell, the
  first-run flow, the sign-in screen, the invite screen, the account menu, the profile dialog with
  its handle field, and the people dialog.
- 13 CLI tests (`apps/server/test/accounts-cli.test.ts`).

`node apps/server/dist/accounts-cli.js` is the way back in when nobody can sign in: `list`,
`promote`, `demote`, `reset-password`, `invite`, `delete`. It runs on the machine that owns the
file, while the server keeps running.

### Mentions and Slack notifications

`@handle` in the editor names a person, and the markdown keeps exactly that text. Nothing is
encoded, so a page read in a terminal or on GitHub still shows who was named. The handle is the
whole reference, so a handle change has to rewrite the pages that carry it.

- **Handles** are created with the account, from the display name: "Ada Lovelace" becomes
  `@ada.lovelace`, and a second one becomes `@ada.lovelace.2`. Accents are stripped, so the handle
  stays ascii. `accounts.db` moved to schema version 2, which adds the `handle` and `slack_user_id`
  columns and gives every existing account a handle on first open.
- **A handle can be changed**, by the person who holds it or by an admin, under "Your account".
  `GET /me/handle` says how many pages and comments carry it today, and the screen repeats that
  before the change is agreed to. `POST /me/handle` writes the account row, then sweeps every
  workspace the caller can open and rewrites the pages through the content store, one commit per
  workspace: `Rename @ada.lovelace to @ada.king in 2 pages`. Comment bodies are rewritten in
  `accounts.db` in the same call, and a rewritten comment is not marked as edited.
- **An old handle stays reserved** for the person who gave it up, in `handle_reservations`. Nobody
  else can claim it, and a stale copy of a page still resolves to them, so a Slack message still
  lands. Taking an old handle back frees its reservation. Uniqueness is server-wide and shared with
  the agents, so an agent handle refuses a rename too. Agent handles themselves are unchanged: an
  agent still keeps the handle it was made with.
- **One change a day.** `HANDLE_CHANGE_COOLDOWN_MS` is 24 hours, held in `users.handle_changed` and
  enforced in the store, so the admin route cannot be used to get around it. A rename sweeps the
  repository, so an unbounded one is a way to churn it.
- **Schema version 9** adds `users.handle_changed` and the `handle_reservations` table. The column
  needs its `addColumn()` call, because an existing file never re-runs the `CREATE TABLE` block.
- **The `@` menu** filters the roster in the browser, because the roster is small and already
  cached. It never asks the server.
- **The markdown rule** matches only at the start of a word, so `mail@example.com` stays an
  address, and markdown-it never sees the inside of code, so `` `@ada` `` names nobody.
- **Delivery** is stateless. On each save the server compares the handles in the new body with the
  handles in the previous body and sends one Slack direct message per new handle. There is no
  notification table to fall out of step with the pages, and you are never told about your own
  mention. The queue is a promise chain off the request path, so a save never waits for Slack and
  never fails because Slack is down.
- **Connecting Slack** needs one workspace bot token (`TABLINUM_SLACK_BOT_TOKEN`, scopes
  `chat:write` and `users:read.email`). Each person clicks "Connect Slack" in "Your account";
  tablinum looks their email address up in Slack, or takes a member id that is pasted in.
  `TABLINUM_PUBLIC_URL` supplies the origin of the link inside the message.

Verified by tests, not by a live Slack workspace:

- 31 shared tests (`packages/shared/test/mentions.test.ts`) cover the handle rules, the derivation,
  the code-aware scan and the rewrite, which skips a fenced block and inline code and leaves
  `@ada.lovelace.2` alone.
- 23 accounts tests (`packages/accounts/test/handles.test.ts`) cover handle creation, collisions,
  the version 1 migration, the Slack id and the change: the reservation, a refusal from a person,
  an agent or a reservation, a take-back, and the cooldown at one day less one millisecond.
- 4 accounts tests (`packages/accounts/test/comments.test.ts`) cover the comment rewrite across
  workspaces, and 6 migrate tests age a real file, including one for `handle_changed` and one for
  the reservations table.
- 16 server tests (`apps/server/test/mentions.test.ts`) cover the three `/me/slack` routes and
  delivery, with a stub transport: new page, only-the-new-handles on a patch, self-mention, code,
  unknown handle, and a Slack that throws.
- 16 server tests (`apps/server/test/handles.test.ts`) cover the preview, the page and comment
  rewrite in one commit, the old handle still resolving to a Slack message, both 409s, the admin
  route, and the member who may not rename somebody else.
- 13 web tests (`apps/web/test/editor/mention.test.tsx`) plus 16 round-trip corpus entries, and 5
  web tests (`apps/web/test/accounts.test.tsx`) for the handle field, its warning and its refusal.
- `e2e/handle.spec.ts` mentions a person on a page and in a comment, renames them in the browser,
  and checks the page, the chip and the reserved old handle.

### Custom emoji

Anybody who is signed in uploads an image, names it, and writes `:name:` wherever a unicode emoji
works: in a page body, in the `:` menu, in the emoji picker, as a page icon and as a space or
workspace icon. The markdown keeps the plain `:name:` text and the picture is resolved when the
page is drawn, so the content repo stays a tree of markdown.

- **Storage** is a `custom_emoji` table in `accounts.db`, beside the avatar blobs, at schema
  version 5. No filename is derived from anything a caller sends, so there is no path to traverse.
- **Uniqueness** is a `UNIQUE` index on the shortcode. The insert catches the constraint error and
  answers `CONFLICT`, so two uploads of one name cannot race past a route check.
- **Permissions** live in `AccountStore.deleteCustomEmoji`: the uploader or an admin, and
  `UNAUTHORIZED` for anybody else. The route only passes `request.principal.admin` through.
- **Validation** refuses a name outside `[a-z0-9_-]+` or over 32 characters, an empty upload, more
  than 256 KB, and any bytes whose magic number is not png, jpeg, webp or gif. The declared content
  type is never trusted.
- **The markdown rule** claims a shortcode only when somebody has uploaded it, so `10:30:45` stays
  a time and a colon in prose stays a colon.

- 6 accounts tests cover the store: storage and sniffing, a taken shortcode, six refusals, delete
  by the uploader, the admin override, and the purge when an account is deleted.
- 8 server tests (`apps/server/test/emoji.test.ts`) cover upload, list, image, oversize, non-image
  bytes, duplicate, delete-own, delete-other as a member and as an admin, and no credential.
- 11 web tests (`apps/web/test/editor/customEmoji.test.tsx`) cover inline rendering, the round
  trip, an unknown name, the `:` menu and the picker section.

### MCP server

`packages/mcp/dist/cli.js` was spawned over stdio by a real MCP `Client` against the live API
earlier in the project, when the catalogue held 11 tools; it now holds 18. `tools/list` returned
every one of them, `tablinum_list_tree` rendered the outline, `tablinum_create_page` created a page
that REST search then found, and a missing path returned a readable tool error. The later runs
covered the MCP package by its 143 unit tests, plus `e2e/agent-editing.spec.ts` and
`e2e/agent-comments.spec.ts` over the remote endpoint; there has been no second live stdio session.

### Agents and the remote MCP endpoint

An admin adds an agent in the web UI (**Settings**, then **Agents**), writes its identity, and gets
a `gda_` token that is shown once. The token names that agent on every request. An agent is a
writer like any other: it has a name, a `@handle` and a picture of its own, and it has no paused
state, because deleting it is what stops it and its token dies with it:

- `apps/server/test/agents.test.ts`, 13 tests: the handle, the one-time token, the MCP address, an
  agent token that writes pages but gets 401 on the admin routes, the `lastUsed` stamp, an identity
  change, the picture upload and its immutable cache, a rotation that retires the old token, a
  delete, and handles that stay unique across people and agents.
- `apps/server/test/mcp.test.ts`, 9 tests: the handshake instructions carry the agent's own brief,
  another credential gets the shared guidance alone, `tools/list` lists the tablinum tools, a read
  tool and a write tool both run through the loopback client and the written page appears in REST,
  a failing tool reports an error instead of crashing, no credential and a deleted agent both give
  401, `GET` gives 405, and a body that is not JSON-RPC gives 400.
- `packages/accounts/test/store.test.ts`, 10 agent tests: creation, the shared handle namespace in
  both directions, lookup by id and by handle, token resolution, the once-a-minute `lastUsed`
  write, an identity change that never moves the handle, the picture that is kept apart from the
  pictures of the people, rotation, and delete.
- `apps/web/test/agents.test.tsx`, 12 tests: the add form, the token shown once, the listing with
  the name and the initials, the picture upload and removal, the identity edit, the absence of any
  paused state, the confirm before a rotation and before a delete, and the empty state.
- `e2e/agents.spec.ts`, 1 test: an admin adds an agent, reads its name and initials in the list,
  uploads a picture, sees the image replace the initials, removes it, and deletes the agent.

The endpoint is stateless on purpose. Every request carries its own credential, so nothing expires
and a restart loses nothing. Its tools reach the REST layer through a loopback `fetch` built on
`app.inject()`, so an agent gets the same validation, indexing and git commits as the editor, and
exactly the authority the auth hook already granted it.

### An agent edits a page like a person

An agent no longer replaces a page in one call. `tablinum_append_page` is gone and
`tablinum_update_page` now changes the title, the icon and the order only, so every change to the
body goes through a caret:

- `tablinum_open_page` prints the page as numbered blocks and puts the caret on it.
- `tablinum_place_cursor` moves the caret to a phrase, to a block and offset, or to the start or
  the end of the page.
- `tablinum_select` selects a phrase, a block, a run of blocks, or the whole page.
- `tablinum_type` types text over whatever is selected, exactly like a keyboard.
- `tablinum_erase` erases the selection, or a number of characters each side of the caret.

A block is one top-level markdown block: a run of lines with a blank line on each side. A blank
line inside a fence separates nothing, so a code block is always one block. Block indexes line up
with the top-level nodes of the editor's document, which is what lets a browser draw the caret.

The caret lives on the server (`apps/server/src/cursors.ts`), because the remote MCP endpoint
builds a new server for every request and has nowhere of its own to keep one. It is keyed by
credential, workspace and page, so two agents never share a caret and two workspaces never collide
on a page id. It is forgotten after 30 minutes without a move, and it goes when the page goes.

Every tab reading the page sees the caret. `PUT /api/v1/pages/:id/cursor` seats the agent and then
broadcasts `doc-agent-caret` with blocks and offsets; the tab maps that onto a position in its own
document and draws the same marker it draws for another person. Inside a block the count drifts by
whatever markdown syntax the block carries, so the caret is exact in a paragraph and a character
or two out in a heading, which is close enough to show.

- `packages/shared/test/editing.test.ts`, 14 tests: the block split, a fence that holds a blank
  line, clamping, offsets both ways, spans, the splice, and finding every occurrence.
- `apps/server/test/cursors.test.ts`, 13 tests: the round trip, clamping onto a page that shrank,
  two callers, two workspaces, the 30-minute expiry, the sweep, and a page that was deleted.
- `apps/server/test/pages.test.ts`, 5 caret tests: no caret to start with, a caret that comes back,
  the clamp on read, one per credential, and a caret that dies with its page.
- `packages/mcp/test/tools.test.ts`, 14 editing tests: open, place by a phrase and by a block,
  select, type over a selection, erase both ways, and the refusals for a phrase that is not there.
- `apps/web/test/editor/carets.test.ts`, 6 tests: a block and offset mapped onto a document, with
  the clamps at both ends.
- `apps/web/test/editor/docStream.test.tsx`, 2 tests: an agent caret drawn where it points, and
  taken away when the agent leaves.

### An agent comments like a person

An agent reviews as well as writes. Three tools put it in the conversation beside the people:

- `tablinum_comment` opens a thread on the words it quotes, or on the whole page when it quotes
  nothing.
- `tablinum_reply` answers a thread anybody opened.
- `tablinum_resolve_comment` closes a thread, and reopens one with `resolved: false`.

A thread quotes what a reader sees, never the markdown behind it. `packages/mcp/src/comments.ts`
builds the anchor from `markdownToPlainText(page.markdown)`, which is the same flattened text the
browser searches when it re-finds a quote, so `"Release"` anchors a heading and `"# Release"` is
refused with a message that says why. `occurrence` picks which repeat of a phrase to take.

`markdownToPlainText` moved from `@tablinum/search` into `@tablinum/shared`, so the index, the
browser and the MCP package all strip markdown the same way. `@tablinum/search` still re-exports it.

An agent now authors a comment because the server no longer demands an account for one.
`writerOf(request)` in `apps/server/src/auth.ts` returns the agent or the account behind the
credential, and a comment stores that id. An operator token names nobody, so it still reads
comments and writes none. Both rosters opened to match: `GET /api/v1/users` and `GET /api/v1/agents`
answer any signed-in caller, because a comment card and a byline have to turn an id into a name and
a picture. Making an agent is still an admin's job.

- `packages/mcp/test/comments.test.ts`, 10 tests: a heading, a link, a bold run, a code span, the
  occurrence, the case, and every refusal.
- `packages/mcp/test/tools.test.ts`, 14 comment tests: the three tools, the anchor that is actually
  sent, the whole-page thread, and an agent named in the listing.
- `apps/server/test/comments.test.ts`, 3 agent tests: a thread written under the agent's own name, a
  reply and a resolve on a person's thread, and an edit that reaches its own remark and no other.
- `apps/web/test/comments.test.tsx`, 1 test: an agent byline drawn exactly like a person's.
- `e2e/agent-comments.spec.ts`, 1 test: an agent is refused a markdown quote, opens a thread on the
  heading, a reader answers it in the panel, the agent reads the answer back with both names, then
  replies and resolves, and the markdown file never changes.

### An agent at work on an open page

An agent holds no socket, so the REST layer seats it. A page read or write made with an agent token
puts that agent on that page and takes it off the page it was on before. A write also sets
`editing`. The seat lapses 60s after the last tool call, and a delete takes it away at once. The
`page` broadcast now names the agent, so the tab that has the page open pulls the new bytes, merges
them under any unsaved edits it holds, and says who wrote.

- `apps/server/test/live.test.ts`, 5 agent tests: the seat and the announcement, the move between
  two pages, the lapse after `AGENT_PRESENCE_MS`, `dropAgent` including an unknown id, and the
  agent named on a `page` broadcast. One more covers `agentOf`.
- `apps/server/test/agents.test.ts`, 2 end-to-end tests: an agent token reading and then writing
  through REST, which seats it, flips `editing`, and names it on the broadcast; and a delete that
  empties the page.
- `apps/web/test/agentPresence.test.tsx`, 5 tests: the reading chip, the pulse while it writes, the
  chip that goes when the page empties, the message for an edit to the open page, and silence for
  an edit somewhere else.

### Workspaces

A workspace is the top level, above spaces: one git repository, its own search index, its own live
rooms and its own agents. The configured content directory is the default workspace; every other
one lives under `<parent of content dir>/workspaces/<slug>/` and is opened on first use.

- `apps/server/test/workspaces.test.ts`, 12 tests: the default listing, a slug derived from the
  name plus the starter `general` space, two workspaces that cannot see each other's pages, the
  `?workspace=` form, an unknown name that gives NOT_FOUND, a rename that also refuses to delete
  the configured workspace, add/re-role/remove of a member, a 404 for somebody who is not in it, an
  export and import round trip whose zip holds `eng/deploy.md` and `.git/` entries and whose copy
  takes no writes from the original, a name taken from the file name, a non-zip that gives
  VALIDATION, and an agent token that stays in its own workspace even when the request says
  otherwise.
- `packages/accounts/test/store.test.ts`, 10 workspace tests: the rows, a free slug, membership and
  roles, the people an install that predates workspaces inherits, and the refusal to delete the
  last workspace.
- `apps/server/test/zip.test.ts`, 13 tests: the zip writer and reader, including a damaged CRC.
- `apps/web/test/workspaces.test.tsx`, 9 tests: the switcher listing, the header sent after a
  switch, create, import through a file input, the member list, a role change, a rename, the export
  link and the confirm before a delete.

The export is the repository itself, `.git` included, so history travels with the pages. The server
commits what is pending before it packs. An import unwraps a single top directory, so an archive
made by another tool works, and always takes a free slug, so the same zip may be imported twice.

A manual run against the built server confirmed the same path end to end: a new workspace got one
starter space, a page written in it stayed out of the default workspace's search, the export
answered `application/zip` with `filename="team-handbook.zip"` and held `.git/` plus the three
markdown files, the import made `handbook-copy` with the original commit still at `HEAD`, and a
page added to the copy did not appear in the original.

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
- **Web bundle size.** 1.15 MB raw / 373 kB gzipped in one chunk. It loads fine, but there is no
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
- **`TABLINUM_WEB_DIR` and `TABLINUM_SEARCH_DB` are not read by `server.ts`.** The deploy image sets
  both. They are harmless today: `defaultWebDist()` resolves `apps/web/dist` relative to the
  server bundle, and `defaultDbPath(contentDir)` puts `search.db` beside the content dir, which
  is exactly `/data/search.db` in the image. `accounts.db` is derived the same way and has no
  environment variable at all. A second workspace ignores both as well: its index is always
  `<its directory>.search.db`. If the layout changes, `server.ts` must read them.
- **A workspace export and import are built in memory.** The zip is one `Buffer`, capped at 256 MB
  either way, so a very large repository costs that much RAM for the length of the request. A
  streamed archive is the fix if a repository ever gets near the cap.
- **Deleting a workspace leaves its files on disk.** tablinum forgets the workspace, its members and
  its agents, but never removes a git repository on an API call. Freeing the disk is a manual step.
- **A repair rewrites the file.** A markdown file that is missing any required frontmatter field
  is rewritten once on the next scan to complete it. This keeps page ids stable, but it means a
  partially hand-written file is not preserved byte for byte. Complete files are never touched.
- **Inside one workspace the search index is not access-scoped.** Every member of a workspace can
  search every space in it. A role decides who administers people, not who reads which page. A
  workspace is the only boundary: to keep two sets of pages apart, put them in two workspaces.
- **Only `POST /auth/login` and `POST /auth/register` are rate limited.** The throttle is 10
  failures per IP address in 5 minutes and lives in memory, so a restart clears it and two
  processes do not share it. No other endpoint is limited.
- **Presence names a person by their account, but a name is not proof.** The live channel takes
  the name the tab sends and does not check it against the session, so a chip is a courtesy, not
  an audit trail. Only the git commit author is authoritative.
- **Nothing links a page to the account that wrote it.** Commits carry the configured git author,
  not the signed-in person, so the history does not say who made a change.
- **Nobody sends the invite email.** The server returns a link and the UI shows it once. Passing
  it on is the admin's job. There is no mail configuration anywhere.
- **An out-of-band write in the same instant as an API save is swallowed.** The watcher drops one
  echo per file per API write. If a person or a `git pull` writes the same file inside chokidar's
  `awaitWriteFinish` window (120 ms) of an API save, both writes coalesce into one event, that
  event consumes the echo mark, and the out-of-band change is never indexed or broadcast. The live
  run reproduced this at a 20 ms gap and passed at a 1 s gap. A real editor or pull never lands
  that close to a save, so this is recorded, not fixed; the fix is to compare the file's content
  hash instead of counting events.

## Behaviour changes worth knowing

- **New space slugs must be lower case and URL-safe** (`/^[a-z0-9][a-z0-9-]*$/`).
  `createSpace('Ops Team', ...)` now fails with VALIDATION. A directory that a human created by
  hand keeps working: `listSpaces()` and `getSpace()` still accept any single-segment name, so an
  existing `My Docs/` directory is read, listed and served.
- **Dot-prefixed path segments are refused.** The scanner skips `.git` and friends, so a page at
  `docs/.hidden` would have been written and then never indexed.
- **A database schema write may carry `baseRev`.** A schema write sends the whole schema, so two
  edits made from one starting point used to overwrite each other: two quick clicks on "Add a
  property" left one property. With `baseRev` the server settles the two per property id and per
  view id, and refuses only a real overlap with 409 CONFLICT. Without `baseRev` the schema is
  replaced whole, which is what an agent and a script want. The browser always sends it.

---

## How to run it

### Install and verify

```bash
cd /Users/pmihaylov/prg/repos/tablinum
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

The banner prints the web URL and the API token. Open the web UI to create the first account.

### Production-style run against your own content

```bash
pnpm -r build

export TABLINUM_CONTENT_DIR=/absolute/path/to/content
export TABLINUM_PORT=4000
export TABLINUM_API_TOKENS=your-token-here
export TABLINUM_SESSION_SECRET=$(openssl rand -hex 32)
export TABLINUM_AUTOCOMMIT_MS=15000     # quiet period before the edits are committed
export TABLINUM_COMMIT_MAX_HOLD_MS=120000 # cap on that wait
export TABLINUM_AUTOPULL_MS=60000        # 0 turns the periodic pull off
export TABLINUM_AUTOPUSH_MS=5000         # 0 turns the automatic push off

node apps/server/dist/server.js
```

Open `http://localhost:4000`. The built web UI is served from the same port.

### Seed demo content somewhere else

```bash
pnpm seed -- --dir /tmp/tablinum-content
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
claude mcp add tablinum --scope project \
  --env TABLINUM_URL=http://127.0.0.1:4000 \
  --env TABLINUM_TOKEN=your-token-here \
  -- node /Users/pmihaylov/prg/repos/tablinum/packages/mcp/dist/cli.js
```

### Docker

```bash
pnpm docker:build
cd deploy && cp .env.example .env && $EDITOR .env && docker compose up -d
```

See `deploy/README.md` for remotes, TLS, backup and troubleshooting.
