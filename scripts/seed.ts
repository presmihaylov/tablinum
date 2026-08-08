#!/usr/bin/env tsx
/**
 * Seed a demo gitdocs content repo.
 *
 *   pnpm seed                          seed $GITDOCS_CONTENT_DIR (or the default)
 *   pnpm seed -- --dir /tmp/content    seed somewhere else
 *   pnpm seed -- --force               replace the demo spaces if they exist
 *   pnpm seed -- --no-git              do not init or commit the repo
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Frontmatter, PagePath } from '@gitdocs/shared';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Shared = typeof import('@gitdocs/shared');

/** Resolve @gitdocs/shared through the workspace, or fall back to its build output. */
async function loadShared(): Promise<Shared> {
  try {
    return await import('@gitdocs/shared');
  } catch {
    const built = resolve(ROOT, 'packages/shared/dist/index.js');
    if (!existsSync(built)) {
      throw new Error(
        'Cannot resolve @gitdocs/shared. Run: pnpm --filter @gitdocs/shared build',
      );
    }
    return (await import(pathToFileURL(built).href)) as Shared;
  }
}

const {
  FrontmatterSchema,
  SpaceFileSchema,
  assertValidPagePath,
  loadConfig,
  newPageId,
  pagePathToRelFile,
  parseOrThrow,
  spaceFileRelPath,
} = await loadShared();

// ---------------------------------------------------------------------------
// YAML emitter - small on purpose, the seed only writes scalars and string lists.
// ---------------------------------------------------------------------------

const PLAIN_SCALAR_RE = /^[A-Za-z][A-Za-z0-9 ._/-]*$/;
const RESERVED_WORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n']);

function yamlValue(value: string | number | boolean | null | string[]): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(', ')}]`;
  if (PLAIN_SCALAR_RE.test(value) && !RESERVED_WORDS.has(value.toLowerCase())) return value;
  return JSON.stringify(value); // JSON strings are valid YAML double-quoted scalars
}

/** Frontmatter block, keys in the order the contract fixes. */
function frontmatterYaml(fm: Frontmatter): string {
  const lines = [`id: ${fm.id}`, `title: ${yamlValue(fm.title)}`];
  if (fm.icon !== undefined) lines.push(`icon: ${yamlValue(fm.icon)}`);
  if (fm.order !== undefined) lines.push(`order: ${fm.order}`);
  // Quoted, so every YAML parser hands back a string instead of a Date.
  lines.push(`created: ${JSON.stringify(fm.created)}`);
  lines.push(`updated: ${JSON.stringify(fm.updated)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// demo content
// ---------------------------------------------------------------------------

interface SeedPage {
  path: PagePath;
  title: string;
  icon?: string;
  order?: number;
  /** Days before "now" the page was created. Higher = older. */
  age: number;
  markdown: string;
}

interface SeedSpace {
  slug: string;
  name: string;
  icon: string;
  order: number;
  pages: SeedPage[];
}

const DOCS_PAGES: SeedPage[] = [
  {
    path: 'docs',
    title: 'Product Docs',
    icon: '📘',
    order: 1,
    age: 30,
    markdown: `
Everything a new teammate needs, in one place. Every page here is a markdown
file in a git repo, so the docs review like code and roll back like code.

## Start here

- [[docs/getting-started]] - write your first page in about two minutes
- [[docs/concepts]] - how spaces, pages and properties fit together
- [[docs/guides]] - short task guides
- [[engineering]] - runbooks and architecture notes

## House rules

1. One idea per page. Split a page as soon as it needs two headings you would
   link to separately.
2. Give every page an owner in its \`owner\` property.
3. Link with wikilinks. Backlinks then build the map for you.
`,
  },
  {
    path: 'docs/getting-started',
    title: 'Getting started',
    icon: '🚀',
    order: 1,
    age: 29,
    markdown: `
## Write your first page

1. Press \`Cmd\` + \`K\` to open the command palette.
2. Choose **New page**, pick a parent, and give it a title.
3. Type \`/\` on an empty line to open the block menu: headings, lists, tables,
   quotes, code, callouts and dividers.
4. Stop typing. The page is saved and committed for you.

## What just happened on disk

Your page became a markdown file with a YAML header:

\`\`\`text
content/docs/getting-started.md
\`\`\`

The header carries the id, the title and any properties. The body is plain
CommonMark. Read [[docs/concepts/frontmatter]] for the full field list.

## Next

- [[docs/concepts/pages-and-spaces]] - where a page lives and how to move it
- [[docs/guides/keyboard-shortcuts]] - the shortcuts worth learning first
- [[docs/concepts/wikilinks|how linking works]]
`,
  },
  {
    path: 'docs/concepts',
    title: 'Concepts',
    icon: '🧩',
    order: 2,
    age: 28,
    markdown: `
The four ideas that explain the whole product.

| Concept | One line |
| --- | --- |
| Space | A top-level section. One directory. |
| Page | One markdown file. Gains children by becoming a directory. |
| Frontmatter | A YAML header the app owns: id, title, icon and sort order. |
| Wikilinks | Double-bracket links that produce backlinks automatically. |

- [[docs/concepts/pages-and-spaces]]
- [[docs/concepts/frontmatter]]
- [[docs/concepts/wikilinks]]
`,
  },
  {
    path: 'docs/concepts/pages-and-spaces',
    title: 'Pages and spaces',
    order: 1,
    age: 27,
    markdown: `
A **space** is a top-level section. On disk it is one directory with a
\`_space.yml\` file that holds its name, its icon and its sort order.

A **page** is one markdown file. It has two shapes:

- a leaf page is \`guides/keyboard-shortcuts.md\`
- a page with children is \`guides/index.md\`, with the children beside it

You never do that move by hand. Add a child under a leaf and the page becomes a
directory; remove the last child and it becomes a plain file again.

## Moving a page

Drag it in the sidebar. The file moves, the children move with it, and the page
id stays the same, so every link and every bookmark keeps working.

## Related

- [[docs/concepts/frontmatter]]
- [[engineering/architecture/content-store|how the store does it]]
`,
  },
  {
    path: 'docs/concepts/frontmatter',
    title: 'Frontmatter and properties',
    order: 2,
    age: 26,
    markdown: `
Every page starts with a YAML header. The editor writes it for you, but you can
edit it in git and the app picks the change up.

\`\`\`yaml
---
id: pg_01J8XYZQ7M4K2C9V0R5T3B6H8N
title: Deploy runbook
icon: "🚀"
order: 10
created: "2026-08-01T10:00:00.000Z"
updated: "2026-08-06T09:12:44.000Z"
---
\`\`\`

| Field | Required | Notes |
| --- | --- | --- |
| \`id\` | yes | Stable forever. Never edit it. |
| \`title\` | yes | Shown in the sidebar and in search. |
| \`icon\` | no | One emoji. |
| \`order\` | no | Sorts siblings. Missing sorts by title. |
| \`created\` / \`updated\` | yes | ISO 8601, UTC. |

The app owns every key. Write the body, and let gitdocs keep the header
correct.

See [[docs/concepts/pages-and-spaces]] for where the file lives.
`,
  },
  {
    path: 'docs/concepts/wikilinks',
    title: 'Wikilinks and backlinks',
    order: 3,
    age: 25,
    markdown: `
Link to another page by its path:

\`\`\`text
[[engineering/runbooks/deploy]]
[[engineering/runbooks/deploy|the deploy runbook]]
\`\`\`

The first form shows the target title. The second shows your own words.

## Backlinks

Every page lists what points at it. Open [[docs/concepts/frontmatter]] and the
backlinks panel shows this page, because the link above exists.

Backlinks make two jobs easy:

- [ ] find the orphan pages nobody links to
- [x] see what breaks before you delete a page

Renaming a page rewrites the links that point at it, because the link resolves
through the page id, not through the text.

Back to [[docs/getting-started|the quick start]].
`,
  },
  {
    path: 'docs/guides',
    title: 'Guides',
    icon: '🗺️',
    order: 3,
    age: 24,
    markdown: `
Short, task-shaped pages. Each one answers a single question.

- [[docs/guides/keyboard-shortcuts]]
- [[docs/guides/working-with-agents]]
`,
  },
  {
    path: 'docs/guides/keyboard-shortcuts',
    title: 'Keyboard shortcuts',
    order: 1,
    age: 23,
    markdown: `
| Shortcut | Action |
| --- | --- |
| \`Cmd\` + \`K\` | Command palette |
| \`Cmd\` + \`P\` | Jump to a page |
| \`Cmd\` + \`Shift\` + \`F\` | Search every space |
| \`/\` | Block menu on an empty line |
| \`Cmd\` + \`Enter\` | Toggle a task list item |
| \`Cmd\` + \`B\` / \`I\` | Bold, italic |
| \`Esc\` | Leave the editor, keep the page |

Learn the first three and the rest can wait. More basics in
[[docs/getting-started]].
`,
  },
  {
    path: 'docs/guides/working-with-agents',
    title: 'Working with coding agents',
    order: 2,
    age: 22,
    markdown: `
Agents edit the same files you do. They reach the content three ways:

1. **REST API** - \`/api/v1/pages\`, with a bearer token.
2. **MCP server** - the same operations as tools, for an assistant.
3. **git** - clone the content repo and edit the markdown directly.

## Keep both sides safe

- Give each agent its own token so you can revoke one alone.
- Let the agent write to its own space while you trust it.
- Review the commits. Each edit is a normal commit with a normal diff.

\`\`\`bash
curl -s -H "Authorization: Bearer $GITDOCS_TOKEN" \\
  "http://localhost:4000/api/v1/search?q=deploy&limit=5"
\`\`\`

Agents keep the header intact, so nothing you set by hand is lost. See
[[docs/concepts/frontmatter]] and [[engineering/architecture/git-engine]].
`,
  },
];

const ENGINEERING_PAGES: SeedPage[] = [
  {
    path: 'engineering',
    title: 'Engineering',
    icon: '🛠️',
    order: 1,
    age: 30,
    markdown: `
How the service is built and how to operate it.

- [[engineering/runbooks]] - what to do when the pager goes off
- [[engineering/architecture]] - how the pieces fit
- [[docs]] - the product handbook

> Every runbook needs an owner and a rehearsal date. A runbook nobody has run
> is a wish, not a runbook.
`,
  },
  {
    path: 'engineering/runbooks',
    title: 'Runbooks',
    icon: '📟',
    order: 1,
    age: 29,
    markdown: `
One page per procedure. This page is the on-call index.

- [[engineering/runbooks/deploy]]
- [[engineering/runbooks/incident-response]]
- [[engineering/runbooks/restore-from-backup]]
`,
  },
  {
    path: 'engineering/runbooks/deploy',
    title: 'Deploy runbook',
    icon: '🚀',
    order: 1,
    age: 20,
    markdown: `
## Before you start

- [ ] CI is green on \`main\`
- [ ] The content repo has no unpushed commits
- [ ] Somebody else is awake

## Steps

\`\`\`bash
git pull --ff-only
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps
\`\`\`

Wait for the health check to report \`healthy\`, then confirm by hand:

\`\`\`bash
curl -fsS http://localhost:4000/api/v1/health
\`\`\`

## Roll back

The image is the only moving part. Retag the previous image and bring it up
again. Content is unaffected, because content lives in the git repo on the
volume.

If the deploy broke the service, open [[engineering/runbooks/incident-response]].
Background on the commit loop: [[engineering/architecture/git-engine]].
`,
  },
  {
    path: 'engineering/runbooks/incident-response',
    title: 'Incident response',
    icon: '🚨',
    order: 2,
    age: 19,
    markdown: `
## First five minutes

1. Say in the channel that you are on it.
2. Check \`GET /api/v1/health\` and \`GET /api/v1/git/status\`.
3. Decide: is content at risk, or only availability? Content at risk always
   wins.

## Triage table

| Symptom | First check | Page |
| --- | --- | --- |
| 502 from the proxy | container health | [[engineering/runbooks/deploy]] |
| Edits do not save | disk full, git status | [[engineering/architecture/git-engine]] |
| Search returns nothing | index file present | [[engineering/architecture/search-index]] |
| Repo will not commit | merge conflict markers | [[engineering/runbooks/restore-from-backup]] |

## After

Write the timeline while it is fresh. Link the runbook you used, so the next
person lands on it directly.
`,
  },
  {
    path: 'engineering/runbooks/restore-from-backup',
    title: 'Restore from backup',
    icon: '♻️',
    order: 3,
    age: 18,
    markdown: `
The backup is a git remote. Restoring is a clone.

\`\`\`bash
docker compose down
docker volume rm gitdocs_gitdocs-data
docker compose up -d           # the container clones the remote on first boot
\`\`\`

## Restore a single page

\`\`\`bash
git -C /data/content log --oneline -- docs/getting-started.md
git -C /data/content checkout <sha> -- docs/getting-started.md
\`\`\`

The search index is derived data. Delete it and it rebuilds:
[[engineering/architecture/search-index]].

Rehearse this every quarter. An untested restore is not a backup.
`,
  },
  {
    path: 'engineering/architecture',
    title: 'Architecture',
    icon: '🏗️',
    order: 2,
    age: 28,
    markdown: `
Four packages and two apps. The rule that shapes all of them: **the markdown
files are the source of truth**. Everything else is a cache you can delete.

\`\`\`text
apps/web      block editor, page tree, search UI
apps/server   REST API
packages/core       reads and writes the markdown files
packages/git-sync   commits, pulls, pushes
packages/search     full-text index
packages/mcp        the same operations, as agent tools
\`\`\`

- [[engineering/architecture/content-store]]
- [[engineering/architecture/git-engine]]
- [[engineering/architecture/search-index]]
`,
  },
  {
    path: 'engineering/architecture/content-store',
    title: 'Content store',
    order: 1,
    age: 17,
    markdown: `
The store owns the mapping between a page path and a file:

| Page path | File |
| --- | --- |
| \`docs/getting-started\` | \`docs/getting-started.md\` |
| \`docs/concepts\` | \`docs/concepts/index.md\` |

It also keeps the id index, so a page id survives every rename and every move.

## Repairs

A file dropped in by hand has no header. On the next read the store adds one:
a fresh id, the title taken from the first heading or from the filename, and
timestamps taken from the file. Nothing is rejected, so copying an existing
docs folder into \`content/\` just works.

Details of the header: [[docs/concepts/frontmatter]]. Path rules:
[[docs/concepts/pages-and-spaces]].
`,
  },
  {
    path: 'engineering/architecture/git-engine',
    title: 'Git engine',
    order: 2,
    age: 16,
    markdown: `
Every write is committed. Writes are debounced, so a burst of keystrokes turns
into one commit and not into forty.

\`\`\`text
edit -> write file -> debounce -> git add -A -> git commit -> git push
\`\`\`

## Concurrency

A background pull brings in what other people and agents pushed. A pull with
local changes commits first, then pulls with rebase. A conflict stops the loop
and surfaces on \`GET /api/v1/git/status\` instead of guessing which side wins.

## Why this shape

Commits are the audit log, the undo stack and the backup, all at once. Page
history is \`git log\` on one file; a restore is \`git checkout\`.

Used by [[engineering/runbooks/deploy]] and
[[engineering/runbooks/restore-from-backup]].
`,
  },
  {
    path: 'engineering/architecture/search-index',
    title: 'Search index',
    order: 3,
    age: 15,
    markdown: `
Search is SQLite FTS5 over the page title, the body and the path. The index is
derived data: delete the file and it rebuilds from the markdown on the next
boot.

\`\`\`bash
curl -s -H "Authorization: Bearer $GITDOCS_TOKEN" \\
  "http://localhost:4000/api/v1/search?q=runbook&space=engineering&limit=10"
\`\`\`

## Keeping it fresh

- A page write updates its row straight away.
- A git pull re-indexes only the files the pull touched.
- A missing or corrupt index rebuilds in full at boot.

Recovery steps live in [[engineering/runbooks/restore-from-backup]].
`,
  },
];

const SPACES: SeedSpace[] = [
  { slug: 'docs', name: 'Product Docs', icon: '📘', order: 1, pages: DOCS_PAGES },
  { slug: 'engineering', name: 'Engineering', icon: '🛠️', order: 2, pages: ENGINEERING_PAGES },
];

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

interface Options {
  dir: string;
  force: boolean;
  git: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Options | null {
  const fallbackDir = loadConfig(process.env).contentDir;
  const options: Options = { dir: fallbackDir, force: false, git: true, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir' || arg === '-d') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--dir needs a path');
      options.dir = resolve(value);
      i += 1;
      continue;
    }
    if (arg === '--force' || arg === '-f') {
      options.force = true;
      continue;
    }
    if (arg === '--no-git') {
      options.git = false;
      continue;
    }
    if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') return null;
    // `pnpm seed -- --force` forwards the separator itself.
    if (arg === '--') continue;
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

const USAGE = `seed a demo gitdocs content repo

  tsx scripts/seed.ts [options]

  -d, --dir <path>   target content directory (default: $GITDOCS_CONTENT_DIR)
  -f, --force        replace the demo spaces if they already exist
      --no-git       do not init the repo and do not commit
  -q, --quiet        print only the summary line
  -h, --help         show this text
`;

/** Every seeded page, in write order, with a parent-before-child guarantee. */
function allPages(): SeedPage[] {
  const pages = SPACES.flatMap((space) => space.pages);
  const known = new Set(pages.map((page) => page.path));
  for (const page of pages) {
    assertValidPagePath(page.path);
    const parts = page.path.split('/');
    if (parts.length > 1) {
      const parent = parts.slice(0, -1).join('/');
      if (!known.has(parent)) throw new Error(`Seed page ${page.path} has no parent ${parent}`);
    }
  }
  return [...pages].sort((a, b) => a.path.localeCompare(b.path));
}

function buildFrontmatter(page: SeedPage, now: number, index: number): Frontmatter {
  const created = new Date(now - page.age * DAY_MS).toISOString();
  // Edited some time after creation, deterministically, so history looks lived-in.
  const updatedAt = now - page.age * DAY_MS + ((index % 7) + 1) * 6 * HOUR_MS;
  const updated = new Date(Math.min(updatedAt, now)).toISOString();
  const frontmatter: Frontmatter = {
    id: newPageId(),
    title: page.title,
    created,
    updated,
  };
  if (page.icon !== undefined) frontmatter.icon = page.icon;
  if (page.order !== undefined) frontmatter.order = page.order;
  return parseOrThrow(FrontmatterSchema, frontmatter, `frontmatter of ${page.path}`);
}

function pageFileContents(page: SeedPage, frontmatter: Frontmatter): string {
  return `---\n${frontmatterYaml(frontmatter)}\n---\n\n${page.markdown.trim()}\n`;
}

async function writeFileAt(root: string, relPath: string, contents: string): Promise<void> {
  const target = join(root, relPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function initRepo(dir: string, log: (line: string) => void): Promise<void> {
  if (!hasGit()) {
    log('git is not installed, skipping the initial commit');
    return;
  }
  const config = loadConfig(process.env);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: config.gitAuthorName,
    GIT_AUTHOR_EMAIL: config.gitAuthorEmail,
    GIT_COMMITTER_NAME: config.gitAuthorName,
    GIT_COMMITTER_EMAIL: config.gitAuthorEmail,
  };

  if (!existsSync(join(dir, '.git'))) {
    try {
      runGit(['init', '-q', '-b', config.gitBranch], dir, env);
    } catch {
      runGit(['init', '-q'], dir, env);
      runGit(['symbolic-ref', 'HEAD', `refs/heads/${config.gitBranch}`], dir, env);
    }
    runGit(['config', 'user.name', config.gitAuthorName], dir, env);
    runGit(['config', 'user.email', config.gitAuthorEmail], dir, env);
    log(`git init on branch ${config.gitBranch}`);
  }

  runGit(['add', '-A'], dir, env);
  const staged = runGit(['status', '--porcelain'], dir, env).trim();
  if (staged.length === 0) {
    log('nothing to commit');
    return;
  }
  runGit(['commit', '-q', '-m', 'seed: demo content'], dir, env);
  const sha = runGit(['rev-parse', '--short', 'HEAD'], dir, env).trim();
  log(`committed ${sha}`);
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    process.stdout.write(USAGE);
    return 0;
  }
  const log = (line: string): void => {
    if (!options.quiet) process.stdout.write(`${line}\n`);
  };

  const pages = allPages();
  const withChildren = new Set(
    pages.flatMap((page) => {
      const parts = page.path.split('/');
      return parts.length > 1 ? [parts.slice(0, -1).join('/')] : [];
    }),
  );

  await mkdir(options.dir, { recursive: true });
  const existing = (await readdir(options.dir)).filter((entry) => entry !== '.git');
  const clash = SPACES.map((space) => space.slug).filter((slug) => existing.includes(slug));
  if (clash.length > 0 && !options.force) {
    process.stderr.write(
      `seed: ${options.dir} already contains ${clash.join(', ')}.\n` +
        'Pass --force to replace those spaces, or --dir to seed somewhere else.\n',
    );
    return 1;
  }
  for (const slug of clash) {
    await rm(join(options.dir, slug), { recursive: true, force: true });
    log(`replaced space ${slug}`);
  }

  const now = Date.now();
  for (const space of SPACES) {
    const spaceFile = parseOrThrow(
      SpaceFileSchema,
      { name: space.name, icon: space.icon, order: space.order },
      `_space.yml of ${space.slug}`,
    );
    const spaceLines = [`name: ${yamlValue(spaceFile.name)}`];
    if (spaceFile.icon !== undefined) spaceLines.push(`icon: ${yamlValue(spaceFile.icon)}`);
    if (spaceFile.order !== undefined) spaceLines.push(`order: ${spaceFile.order}`);
    const yaml = `${spaceLines.join('\n')}\n`;
    await writeFileAt(options.dir, spaceFileRelPath(space.slug), yaml);
    log(`space  ${space.slug.padEnd(28)} ${space.name}`);
  }

  let index = 0;
  for (const page of pages) {
    const frontmatter = buildFrontmatter(page, now, index);
    const relPath = pagePathToRelFile(page.path, withChildren.has(page.path));
    await writeFileAt(options.dir, relPath, pageFileContents(page, frontmatter));
    log(`page   ${page.path.padEnd(28)} ${relPath}`);
    index += 1;
  }

  if (options.git) await initRepo(options.dir, log);

  process.stdout.write(
    `\nSeeded ${pages.length} pages in ${SPACES.length} spaces at ${options.dir}.\n`,
  );
  return 0;
}

process.exitCode = await main();
