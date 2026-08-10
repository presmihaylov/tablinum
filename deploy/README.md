# Running tablinum

tablinum is one container. It serves the web UI and the REST API on port 4000, and it keeps every
page as a markdown file in a git repo on a volume. There is no database to administer: the search
index is derived data you can delete at any time, and the content repo is an ordinary git repo you
can clone, diff, revert and push.

That shape decides most of the operational answers below. Backup is `git push`. Restore is
`git clone`. Audit is `git log`. Import is `cp`.

```
deploy/
  Dockerfile              multi-stage build, non-root runtime
  docker-compose.yml      the tablinum service, plus a commented-out Caddy service
  docker-entrypoint.sh    prepares /data and the git identity
  .env.example            every setting, documented
  Caddyfile.example       three TLS options for a VPN-internal hostname
```

---

## 1. Quickstart

Requirements: Docker 24 or newer with the compose plugin.

```bash
cd deploy
cp .env.example .env
```

Edit `.env` and set a session secret and one API token:

```bash
# in deploy/.env
TABLINUM_API_TOKENS=$(openssl rand -hex 32)
TABLINUM_SESSION_SECRET=$(openssl rand -hex 32)
```

Then build and start:

```bash
docker compose build
docker compose up -d
docker compose logs -f tablinum
```

Open <http://localhost:4000>. Nobody has claimed a fresh server, so the sign-in screen asks you to
create the first account. You become the admin, and you name your first workspace next.

**Claim it before anybody else can.** The setup form is public until the first account exists, so
open the page as soon as the container is up. After that, invite everybody else with a link from
Settings > Workspace. `TABLINUM_API_TOKENS` is for agents and scripts only.

Check it from the shell:

```bash
curl -fsS http://localhost:4000/api/v1/health
# {"ok":true,"version":"0.1.0","contentDir":"/data/content"}

curl -fsS -H "Authorization: Bearer $TABLINUM_API_TOKENS" \
  http://localhost:4000/api/v1/tree | head
```

> **A server with no account yet is unclaimed.** `POST /api/v1/auth/setup` is public until the
> first account exists, and the container logs a warning at boot to say so. Open the page and
> create your admin account straight after the first start.

### What lives where

| Path in the container | What it is | Survives a rebuild? |
| --- | --- | --- |
| `/data/content` | the content git repo, one markdown file per page | yes, named volume |
| `/data/search.db` | SQLite full-text index, derived data | yes, but disposable |
| `/data/accounts.db` | people, passwords, sessions, invites, avatars | yes, and **not** disposable |
| `/app` | the compiled server, the packages and `apps/web/dist` | no, it is the image |

`accounts.db` sits beside the content repo, never inside it, so no password or avatar is ever
committed or pushed. That also makes it the only state the git remote does not back up. See
section 5.

The volume is `tablinum_tablinum-data`. The container runs as the non-root `node` user (uid 1000),
which owns `/data`.

### Some demo content to look at

From a checkout of the repository, not from the container:

```bash
pnpm seed -- --dir /tmp/tablinum-demo
```

That writes two spaces and eighteen pages, some carrying `status` / `owner` / `priority`
properties so the table views have real rows, and wikilinks between pages so backlinks are not
empty. Point `TABLINUM_CONTENT_DIR` at the directory, or copy it into the volume (see section 6).

### Running from source instead

You do not need Docker to develop. From the repository root:

```bash
pnpm install
pnpm dev              # scripts/dev.sh
```

That builds the workspace libraries, seeds demo content on a first run, starts the API on 4000 and
the web dev server on 5173, and prints the generated dev token. The token is written to
`.data/dev.env` and reused on every later run; delete that file to rotate it.

---

## 2. Configuration

Every setting is an environment variable, and every one of them is documented in
[`.env.example`](.env.example). `docker-compose.yml` forces the three that describe the container
layout (`TABLINUM_CONTENT_DIR`, `TABLINUM_SEARCH_DB`, `TABLINUM_PORT`); set everything else in
`deploy/.env`.

The two that matter on day one:

| Variable | Why you care |
| --- | --- |
| `TABLINUM_API_TOKENS` | comma-separated bearer tokens. One per consumer, so you can revoke one alone. |
| `TABLINUM_GIT_REMOTE` | the remote the content repo pushes to. This is your backup. |

Apply a change with `docker compose up -d`. Compose recreates the container; the volume, and
therefore all content, stays.

---

## 3. Point the content repo at a private remote

Without a remote, tablinum still commits every edit locally. You get history and undo, but the only
copy is on that one host. Add a remote and every commit is pushed, which gives you an off-host
backup, a code-review surface, and a way for people to edit the docs from a normal git checkout.

Create an **empty private repository** on GitHub, Gitea or GitLab. Do not add a README: tablinum
pushes its own first commit.

You then have two ways to authenticate. Pick one.

### Option A: an SSH deploy key (recommended)

Best when you control the host and want a credential that is scoped to exactly one repository and
never expires by surprise.

```bash
# on the docker host, in the deploy/ directory
mkdir -p ssh && chmod 700 ssh
ssh-keygen -t ed25519 -N "" -C "tablinum@$(hostname)" -f ssh/id_ed25519
chmod 600 ssh/id_ed25519
ssh-keyscan github.com > ssh/known_hosts       # or your Gitea host
cat ssh/id_ed25519.pub
```

Add that public key to the repository as a **deploy key with write access** (GitHub: Settings ->
Deploy keys; Gitea: Settings -> Deploy keys, tick "Enable write access").

Uncomment the SSH mount in `docker-compose.yml`:

```yaml
    volumes:
      - tablinum-data:/data
      - ./ssh:/home/node/.ssh:ro
```

Set the remote in `deploy/.env`:

```bash
TABLINUM_GIT_REMOTE=git@github.com:acme/docs-content.git
```

The entrypoint picks up `/home/node/.ssh/id_ed25519` automatically and runs ssh in batch mode, so a
missing host key fails fast instead of hanging on a prompt. If you would rather not mount a
`known_hosts` file, put the output of `ssh-keyscan` into `TABLINUM_SSH_KNOWN_HOSTS` instead.

**Never commit `deploy/ssh/`.** `deploy/.env` is already ignored by the root `.gitignore` rule for
`.env`; the key directory needs its own line:

```bash
echo 'deploy/ssh/' >> .gitignore
git check-ignore -v deploy/ssh/id_ed25519      # confirm before you push
```

### Option B: an HTTPS deploy token

Best when outbound SSH is blocked by a firewall, or when the git host only issues tokens. It is a
single string, so it is easy to leak and easy to rotate.

GitHub calls this a fine-grained personal access token with `Contents: read and write` on that one
repository. Gitea and GitLab call it a repository access token or a deploy token.

```bash
TABLINUM_GIT_REMOTE=https://x-access-token:github_pat_xxx@github.com/acme/docs-content.git
```

The token is now inside a URL, which means it also lands in `.git/config` inside the volume and in
any log line that prints the remote. Treat the volume as a secret. Give the token an expiry and put
a reminder in your calendar.

### Which one to pick

| | SSH deploy key | HTTPS token |
| --- | --- | --- |
| Scope | one repository, by construction | one repository if the host supports it |
| Where the secret lives | a mounted file, read-only | inside the remote URL, in the volume |
| Expiry | none unless you remove the key | usually forced, so it will break one day |
| Firewall | needs outbound port 22 | needs outbound port 443 only |
| Rotation | replace the file, restart | edit `.env`, restart, `git remote set-url` |

Use the SSH deploy key unless port 22 is blocked.

### First push

```bash
docker compose restart tablinum
docker compose exec tablinum git -C /data/content remote -v
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/git/push
curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/git/status
```

`GET /api/v1/git/status` reports the branch, the remote, `ahead`, `behind` and any dirty files.
That endpoint is the one to graph or alert on: `ahead` growing without bound means pushes are
failing.

---

## 4. Serve it inside a VPN

tablinum authenticates people with an account and machines with a shared bearer token. That is the
right amount of security for a tool behind a VPN and the wrong amount for the open internet: there
is no MFA, and anyone who reads a token reads and writes all of your documentation.

So: keep it on the private network, and let the VPN be the outer authentication layer.

### Step 1: internal DNS

Give it a name on your internal resolver only.

```
docs.vpn.example.com.   A   10.42.0.17
```

Use a hostname under a domain you actually own, for example `docs.vpn.example.com`. Do not invent a
top-level domain such as `.local` or `.internal`: `.local` collides with mDNS, and a public
certificate authority cannot issue for a name that does not exist publicly, which closes off
option C in step 3 below.

Keep the A record private. Publishing the internal IP in public DNS leaks your network layout for
no benefit.

### Step 2: bind to the VPN interface

In `docker-compose.yml`, change the published port so the container is not reachable from any other
interface:

```yaml
    ports:
      - "127.0.0.1:4000:4000"     # only the reverse proxy on this host
      # or
      - "10.42.0.17:4000:4000"    # only the VPN address of this host
```

A published Docker port bypasses `ufw` and `firewalld` rules, because Docker writes its own
`iptables` chain. Binding the port to one address is the reliable fix.

### Step 3: TLS

Uncomment the `caddy` service in `docker-compose.yml`, then
`cp Caddyfile.example Caddyfile` and keep one of its three blocks.

**Option A: Caddy's internal CA.** Simplest. Caddy generates a root CA and signs the certificate
itself. Nothing external is involved, so it works on a fully isolated network. The cost is that
every client must trust the root once:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./root.crt
# then install root.crt in the OS or browser trust store of each machine
```

**Option B: your own internal CA.** Use this when your organisation already runs one and its root
is on every managed laptop through MDM or group policy. Issue a server certificate for
`docs.vpn.example.com`, mount the certificate and the key read-only, and point the `tls` directive
at them. No client-side work.

**Option C: Let's Encrypt with the DNS-01 challenge.** Use this when you want certificates that
every device already trusts and you do not run a CA. DNS-01 proves control of the domain by writing
a TXT record, so the host needs **no inbound path from the internet at all**: outbound HTTPS to the
ACME server and to your DNS provider API is enough. Keep the A record on the internal resolver and
put only the `_acme-challenge` TXT record in the public zone. This needs a Caddy build that
includes your DNS provider module.

Rule of thumb: isolated network or a handful of machines, take option A. Company laptops with a
managed trust store, take option B. Everyone else, take option C.

### Why not expose it publicly

If you are tempted, the honest checklist you would need first is: per-user accounts, MFA, session
revocation, brute-force protection on the login endpoint, per-token audit logging, and a plan for
the day a token leaks. tablinum has none of those. Put it behind the VPN, or behind an
authenticating proxy that provides them (an identity-aware proxy in front of port 4000 works well,
because tablinum never trusts request headers for identity).

---

## 5. Backup and restore

**The backup is a git remote.** Once section 3 is done, every edit is committed and pushed within
seconds, and the remote holds the full history. The search index rebuilds itself and the container
is rebuilt from the repository.

**One file is not covered by that: `/data/accounts.db`.** It holds the accounts, the password
hashes, the live sessions, the open invites and the avatars, and nothing pushes it anywhere. If you
use accounts, copy it on a schedule. The database runs in WAL mode, so copy the three files
together, and stop the service first so the copy cannot catch a half-written transaction:

```bash
docker compose stop tablinum
docker compose cp tablinum:/data/accounts.db      ./accounts-$(date +%F).db
docker compose cp tablinum:/data/accounts.db-wal  ./accounts-$(date +%F).db-wal   # may not exist
docker compose cp tablinum:/data/accounts.db-shm  ./accounts-$(date +%F).db-shm   # may not exist
docker compose start tablinum
```

The volume snapshot below covers the same file and needs no downtime, so prefer it if you already
run one. Losing this file loses no documents at all: recreate the first admin with the setup screen
and send new invites.

### Verify that the backup is real

Do this monthly. A backup you have never restored is a hope.

```bash
# 1. the working tree is clean and nothing is waiting to be pushed
curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/git/status

# 2. the remote really has the content
git clone --depth 1 git@github.com:acme/docs-content.git /tmp/verify
find /tmp/verify -name '*.md' | wc -l
```

### Belt and braces: a volume snapshot

If you also want a copy that does not depend on the remote being reachable:

```bash
docker run --rm \
  -v tablinum_tablinum-data:/data:ro \
  -v "$PWD:/backup" \
  alpine tar czf /backup/tablinum-$(date +%F).tar.gz -C /data .
```

Run it while the service is up. Git may commit during the tar, in which case the archive contains a
repository that is one commit behind; `git fsck` will still be happy.

### Restore everything

```bash
docker compose down
docker volume rm tablinum_tablinum-data
docker compose up -d
```

With `TABLINUM_GIT_REMOTE` set, tablinum clones the remote into the empty volume on first boot and
rebuilds the search index from the markdown. Expect a few seconds for a few thousand pages.

That brings back every document, but **not the accounts**: the empty volume has no `accounts.db`.
Copy your backup of it in before the first boot, or claim the server again and re-invite everybody.

```bash
docker compose cp ./accounts-2026-08-08.db tablinum:/data/accounts.db
docker compose exec -u root tablinum chown node:node /data/accounts.db
docker compose restart tablinum
```

To restore from a tarball instead:

```bash
docker compose down
docker volume create tablinum_tablinum-data
docker run --rm -v tablinum_tablinum-data:/data -v "$PWD:/backup" \
  alpine sh -c 'tar xzf /backup/tablinum-2026-08-08.tar.gz -C /data && chown -R 1000:1000 /data'
docker compose up -d
```

### Restore one page

You do not need a restore procedure for this. Use git.

```bash
docker compose exec tablinum git -C /data/content log --oneline -- docs/getting-started.md
docker compose exec tablinum git -C /data/content checkout <sha> -- docs/getting-started.md
```

The API does the same thing without a shell:
`GET /api/v1/pages/:id/history` then `GET /api/v1/pages/:id/revisions/:sha`.

---

## 6. Bring in existing markdown docs

Copy the files in and restart. That is the whole procedure.

```bash
# from a directory of .md files on the host
docker cp ./my-old-docs tablinum:/data/content/handbook
docker compose exec -u root tablinum chown -R node:node /data/content/handbook
docker compose restart tablinum
```

On the next read, the content store repairs anything that is missing:

- a file without a YAML header gets one, with a fresh stable id
- the title comes from the first heading, or from the filename if there is none
- `created` and `updated` come from the file timestamps
- an existing header is kept as it is, including any properties you already use

A few things to know before you copy:

- **One directory per space.** `content/handbook/` becomes the space `handbook`. Add
  `content/handbook/_space.yml` with `name:` and an optional `icon:` and `order:` to give it a
  proper display name. Without it, the slug is used.
- **`index.md` is reserved.** A page with children is `<name>/index.md`; a leaf page is
  `<name>.md`. Existing folders that already follow that convention import unchanged.
- **Names starting with `_` are reserved** (`_assets`, `_space.yml`) and are skipped.
- **Images.** Put them in `content/_assets/<pageId>/` and reference `/_assets/<pageId>/<file>`.
  Relative image links that point outside the content directory will not resolve.
- **Wikilinks** are `[[space/page]]` and `[[space/page|alias]]`. Ordinary markdown links keep
  working, so there is no need to rewrite anything before importing.

Check the result, then commit the import as one commit:

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/tree
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"message":"import: handbook"}' \
  http://localhost:4000/api/v1/git/commit
```

Importing a large tree in one go is fine. If you want it reviewable, import it into a branch of the
content repo first and merge it there.

---

## 7. Upgrades

```bash
git pull
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps      # wait for "healthy"
```

Content is on the volume, so an upgrade never touches it. If a release changes the index format,
delete `/data/search.db` and restart; it rebuilds.

To roll back, check out the previous tag, rebuild, and bring it up again.

---

## 8. Troubleshooting

### The container never becomes healthy

```bash
docker compose logs --tail=100 tablinum
docker compose exec tablinum node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>r.text()).then(console.log)"
```

Usual causes: a bad value in `.env` (config validation fails loudly at boot with the variable name
in the message), port 4000 already taken on the host, or `/data` not writable. For the last one:

```bash
docker compose exec -u root tablinum chown -R node:node /data
```

### A merge conflict in the content repo

This happens when someone pushed to the remote while the local copy had uncommitted work, or when
two writers edited the same page. tablinum stops the sync loop rather than guessing a winner, so
your content is intact and the conflict is waiting for you.

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/git/status
docker compose exec tablinum git -C /data/content status
```

Fix it like any other repository:

```bash
docker compose exec tablinum sh -c '
  cd /data/content
  git diff --name-only --diff-filter=U      # the conflicted files
'
```

Then choose one of three routes:

```bash
# a. keep what is on the server, drop the remote side of the conflict
docker compose exec tablinum git -C /data/content checkout --ours -- <file>

# b. keep the remote side
docker compose exec tablinum git -C /data/content checkout --theirs -- <file>

# c. edit the file by hand and remove the <<<<<<< markers
docker compose exec tablinum vi /data/content/<file>
```

Finish:

```bash
docker compose exec tablinum sh -c '
  cd /data/content
  git add -A && git rebase --continue || git commit --no-edit
'
docker compose restart tablinum
```

Conflict markers left in a file are not a corruption: the page still loads, it just shows the
markers as text. Search will index them, so clean up before you forget.

To avoid the whole class of problem, do bulk edits through the API or in a branch, not by editing
files inside the volume while the service is running.

### Search returns nothing, or returns nonsense

The index is derived data. Delete it.

```bash
docker compose stop tablinum
docker compose run --rm -u root tablinum rm -f /data/search.db /data/search.db-wal /data/search.db-shm
docker compose up -d tablinum
docker compose logs -f tablinum        # watch the reindex
```

Nothing is lost: the index is rebuilt from the markdown files. If search is merely stale for one
page, saving that page again re-indexes it.

A `database disk image is malformed` error in the logs means the same thing. Same fix.

### The repo is wedged

Symptoms: writes fail, `git/status` errors, or every commit attempt reports a lock.

```bash
docker compose exec tablinum sh -c 'cd /data/content && git status'
```

Work through these in order:

```bash
# 1. a stale lock from a container that was killed mid-write
docker compose exec tablinum rm -f /data/content/.git/index.lock

# 2. an interrupted rebase or merge
docker compose exec tablinum sh -c 'cd /data/content && git rebase --abort || git merge --abort'

# 3. "detected dubious ownership" after restoring a volume from a tarball
docker compose exec -u root tablinum chown -R node:node /data
docker compose restart tablinum

# 4. a detached HEAD, usually after a manual checkout of an old revision
docker compose exec tablinum sh -c 'cd /data/content && git checkout main'

# 5. verify the object database
docker compose exec tablinum sh -c 'cd /data/content && git fsck --no-progress'
```

If `git fsck` reports real corruption, do not fight it. The remote has the history: delete the
volume and restore as in section 5. Copy any uncommitted files out first:

```bash
docker cp tablinum:/data/content /tmp/rescue
```

### Pushes are failing

`ahead` keeps climbing in `GET /api/v1/git/status`.

```bash
docker compose exec tablinum sh -c 'cd /data/content && git push 2>&1 | tail -20'
```

Read the error. A permission failure means the deploy key lost write access or the token expired.
A host key failure means `known_hosts` is missing: set `TABLINUM_SSH_KNOWN_HOSTS`, or mount the file.
A non-fast-forward means somebody rewrote history on the remote; reconcile it in a normal checkout
before letting tablinum push again.

### Everything looks fine but edits do not save

Check disk space first. Git needs room to write objects, and a full volume produces confusing
errors everywhere else.

```bash
docker compose exec tablinum df -h /data
```

### Nobody can sign in, or the last admin lost their password

A browser cannot reset a password without a password, so the escape hatch runs on the server that
owns the file. It works while the service is running.

```bash
# who exists
docker compose exec tablinum node /app/apps/server/dist/accounts-cli.js list

# hand somebody a new password; it prints one when you do not supply one
docker compose exec tablinum node /app/apps/server/dist/accounts-cli.js \
  reset-password ada@example.com

# make a second admin, so this cannot happen again
docker compose exec tablinum node /app/apps/server/dist/accounts-cli.js promote sam@example.com

# an invite link when the UI is out of reach; open <your url>/invite/<token>
docker compose exec tablinum node /app/apps/server/dist/accounts-cli.js invite --role admin
```

Run it with no arguments for the full list. It signs out every session of the account it touches.

The last resort, if `accounts.db` itself is damaged: delete it and restart. Every account, invite
and avatar goes with it, and **no document is affected**. The server then has no accounts, so the
server is unclaimed again, so the sign-in screen asks the next visitor to create the first admin.

---

## 9. Useful commands

```bash
# service
docker compose ps
docker compose logs -f tablinum
docker compose restart tablinum
docker compose exec tablinum sh

# accounts
docker compose exec tablinum node /app/apps/server/dist/accounts-cli.js list
docker compose exec tablinum node /app/apps/server/dist/accounts-cli.js invite ada@example.com

# content
docker compose exec tablinum git -C /data/content log --oneline -20
docker compose exec tablinum git -C /data/content status --short
docker compose exec tablinum find /data/content -name '*.md' | wc -l

# API
curl -fsS http://localhost:4000/api/v1/health
curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/git/status
curl -fsS -H "Authorization: Bearer $TOKEN" 'http://localhost:4000/api/v1/search?q=deploy&limit=5'
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/git/pull
```

## 10. Building the image by hand

The build context is the repository root, not `deploy/`.

```bash
cd /path/to/tablinum
docker build -f deploy/Dockerfile -t tablinum:latest .
docker run --rm -p 4000:4000 -v tablinum-data:/data \
  -e TABLINUM_API_TOKENS=local-dev-token tablinum:latest
```

The build stage installs `python3`, `make` and `g++` because the SQLite driver compiles a native
addon. None of that reaches the runtime image, which contains only `git`, `openssh-client`, the
production `node_modules`, the compiled `dist` output and the static web bundle.
