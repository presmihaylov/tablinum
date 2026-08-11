import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContentStore } from '@tablinum/core';
import { isAppError, newPageId } from '@tablinum/shared';
import type {
  Backlink,
  CreatePageBody,
  CreateSpaceBody,
  Database,
  Page,
  PageId,
  PagePath,
  PageSummary,
  Space,
  UpdatePageBody,
  UpdateSpaceBody,
} from '@tablinum/shared';
import type { SpaceTree } from '../src/deps.js';
import { FsContentStore } from './support/fs-store.js';

/**
 * Every other file in this directory tests the server against `FsContentStore`, not against the
 * real `ContentStore` production runs. That double is only worth having while the two agree, so
 * this file drives both over the same scenarios and asserts they answer the same thing.
 *
 * A failure here is not a failure of one test. It means some other server test is asserting a
 * behaviour production does not have. Fix the double, not this file: production is the
 * specification.
 */

/** The slice of the store surface these scenarios drive. */
interface Subject {
  listSpaces(): Promise<Space[]>;
  createSpace(input: CreateSpaceBody, owner?: string): Promise<Space>;
  updateSpace(slug: string, patch: UpdateSpaceBody): Promise<Space>;
  getTree(): Promise<SpaceTree[]>;
  listPages(): Promise<PageSummary[]>;
  getPageByPath(path: PagePath): Promise<Page | null>;
  createPage(input: CreatePageBody): Promise<Page>;
  updatePage(id: PageId, patch: UpdatePageBody): Promise<Page>;
  getBacklinks(id: PageId): Promise<Backlink[]>;
  setDatabase(id: PageId, database: Database): Promise<Page>;
}

/** Mirrors `CoreStoreAdapter` in src/server.ts, which is how the real store reaches the routes. */
function coreSubject(core: ContentStore): Subject {
  return {
    listSpaces: () => core.listSpaces(),
    createSpace: (input, owner) =>
      core.createSpace(input.slug, input.name, {
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.order === undefined ? {} : { order: input.order }),
        ...(owner === undefined ? {} : { owner }),
      }),
    updateSpace: (slug, patch) => core.updateSpace(slug, patch),
    getTree: () => core.getTree(),
    listPages: () => core.listPages(),
    getPageByPath: async (path) => core.getPageByPath(path).catch(() => null),
    createPage: (input) => core.createPage(input),
    updatePage: (id, patch) => core.updatePage(id, patch),
    getBacklinks: (id) => core.getBacklinks(id),
    setDatabase: (id, database) => core.setDatabase(id, database),
  };
}

const dirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** What a scenario is allowed to observe. Ids and timestamps differ by design, so they go. */
type Observed = unknown;

const VOLATILE = new Set(['id', 'created', 'updated', 'filePath', 'rev']);

function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (VOLATILE.has(key)) continue;
    out[key] = normalise((value as Record<string, unknown>)[key]);
  }
  return out;
}

/** The outcome of a scenario: what it returned, or how it refused. */
async function outcome(run: () => Promise<Observed>): Promise<unknown> {
  try {
    return { ok: true, value: normalise(await run()) };
  } catch (err) {
    if (isAppError(err)) return { ok: false, code: err.code, status: err.status };
    return { ok: false, thrown: String(err) };
  }
}

type Scenario = (store: Subject, contentDir: string) => Promise<Observed>;

/** Run one scenario against both stores over their own directories and compare the outcomes. */
async function parity(scenario: Scenario): Promise<void> {
  const realDir = await tempDir('parity-real-');
  // No starter space: the double writes none, which is the one difference kept on purpose.
  const core = new ContentStore({ contentDir: realDir, starter: false });
  await core.init();

  const doubleDir = await tempDir('parity-double-');
  const double = new FsContentStore(doubleDir);
  await double.init();

  const real = await outcome(() => scenario(coreSubject(core), realDir));
  const mirrored = await outcome(() => scenario(double, doubleDir));
  expect(mirrored).toEqual(real);
}

/** A page file a hand-made directory can hold, so a scenario is not about the parser. */
function pageFile(title: string): string {
  const now = new Date().toISOString();
  return `---\nid: ${newPageId()}\ntitle: ${title}\ncreated: ${now}\nupdated: ${now}\n---\n\n`;
}

describe('the test double answers what the real content store answers', () => {
  it('roots a space tree at its home page', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      await store.createPage({ path: 'eng/deploy', title: 'Deploy' });
      await store.createPage({ path: 'eng/deploy/steps', title: 'Steps' });
      return (await store.getTree()).map((space) => ({
        slug: space.slug,
        roots: space.tree.map((node) => ({
          path: node.path,
          children: node.children.map((child) => child.path),
        })),
      }));
    });
  });

  it('reports hasChildren from real children, not from the file being an index', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      const home = await store.getPageByPath('eng');
      await store.createPage({ path: 'eng/deploy', title: 'Deploy' });
      const withChild = await store.getPageByPath('eng');
      const leaf = await store.getPageByPath('eng/deploy');
      return {
        emptyHome: home?.hasChildren,
        homeWithChild: withChild?.hasChildren,
        leaf: leaf?.hasChildren,
      };
    });
  });

  it('refuses to move a space home page', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      await store.createSpace({ slug: 'ops', name: 'Ops' });
      const home = await store.getPageByPath('eng');
      if (home === null) throw new Error('no home page');
      return store.updatePage(home.id, { path: 'ops/moved' });
    });
  });

  it('names a missing space and missing parents into existence on a move', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      await store.createPage({ path: 'eng/deploy', title: 'Deploy' });
      const page = await store.getPageByPath('eng/deploy');
      if (page === null) throw new Error('no page');
      const moved = await store.updatePage(page.id, { path: 'ghost/deep/deploy' });
      return { path: moved.path, spaces: (await store.listSpaces()).map((one) => one.slug) };
    });
  });

  it('refuses a move onto its own descendant with the same code', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      await store.createPage({ path: 'eng/deploy', title: 'Deploy' });
      await store.createPage({ path: 'eng/deploy/steps', title: 'Steps' });
      const page = await store.getPageByPath('eng/deploy');
      if (page === null) throw new Error('no page');
      return store.updatePage(page.id, { path: 'eng/deploy/steps/inner' });
    });
  });

  it('leaves updated alone when a patch settles on what is already there', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      const created = await store.createPage({ path: 'eng/deploy', title: 'Deploy' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const after = await store.updatePage(created.id, { title: 'Deploy', markdown: '' });
      return { bumped: after.updated !== created.updated };
    });
  });

  it('adopts a bare directory that has no descriptor', async () => {
    await parity(async (store, contentDir) => {
      await mkdir(join(contentDir, 'loose'), { recursive: true });
      await writeFile(join(contentDir, 'loose/index.md'), pageFile('Loose'), 'utf8');
      return store.createSpace({ slug: 'loose', name: 'Loose notes' });
    });
  });

  it('names a directory with no descriptor after its slug', async () => {
    await parity(async (store, contentDir) => {
      await mkdir(join(contentDir, 'loose-ends'), { recursive: true });
      await writeFile(join(contentDir, 'loose-ends/index.md'), pageFile('Ends'), 'utf8');
      return (await store.listSpaces()).map((space) => ({ slug: space.slug, name: space.name }));
    });
  });

  it('lists pages by path, so a parent precedes its children', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      await store.createPage({ path: 'eng/deploy', title: 'Deploy' });
      await store.createPage({ path: 'eng/deploy/steps', title: 'Steps' });
      return (await store.listPages()).map((page) => page.path);
    });
  });

  it('normalises an icon of only whitespace away', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      return store.updateSpace('eng', { icon: '   ' });
    });
  });

  it('validates a new space slug', async () => {
    await parity((store) => store.createSpace({ slug: 'Not A Slug', name: 'Nope' }));
  });

  it('refuses a database that is not a database with VALIDATION, not a 500', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      const page = await store.createPage({ path: 'eng/db', title: 'DB' });
      // Deliberately not a Database. The real store parses before it touches the value.
      return store.setDatabase(page.id, { nonsense: true } as unknown as Database);
    });
  });

  it('refuses backlinks for an id that does not exist', async () => {
    await parity(async (store) => {
      await store.createSpace({ slug: 'eng', name: 'Engineering' });
      return store.getBacklinks('p_zzzzzzzzzzzzzzzz' as PageId);
    });
  });

  it('writes nothing but the content directory on init', async () => {
    await parity(async (_store, contentDir) => (await readdir(contentDir)).sort());
  });
});
