import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPageId } from '@gitdocs/shared';
import { ContentStore } from '../src/store.js';
import { parse } from '../src/frontmatter.js';
import { silentLogger } from '../src/logger.js';
import {
  codeOf,
  exists,
  makeStore,
  makeTempDir,
  readFileAt,
  removeTempDir,
  writeFileAt,
} from './helpers.js';

let dir = '';
let store: ContentStore;

beforeEach(async () => {
  dir = await makeTempDir();
  store = makeStore(dir);
});

afterEach(async () => {
  await removeTempDir(dir);
});

describe('constructor', () => {
  it('rejects a relative content directory', () => {
    expect(() => new ContentStore({ contentDir: 'content', logger: silentLogger })).toThrow(
      /absolute/,
    );
  });
});

describe('init', () => {
  it('creates a starter space with a welcome page', async () => {
    await store.init();
    expect(await exists(dir, 'docs/_space.yml')).toBe(true);
    expect(await exists(dir, 'docs/index.md')).toBe(true);
    const page = await store.getPageByPath('docs');
    expect(page.title).toBe('Welcome');
    expect(page.space).toBe('docs');
    expect(isPageId(page.id)).toBe(true);
    expect(page.markdown).toContain('# Welcome to gitdocs');
  });

  it('is idempotent', async () => {
    await store.init();
    const before = await readFileAt(dir, 'docs/index.md');
    await store.init();
    expect(await readFileAt(dir, 'docs/index.md')).toBe(before);
    expect(await store.listPages()).toHaveLength(1);
  });

  it('leaves an existing content repository alone', async () => {
    await writeFileAt(dir, 'eng/index.md', '# Engineering\n');
    await store.init();
    expect(await exists(dir, 'docs/index.md')).toBe(false);
    expect((await store.listPages()).map((page) => page.path)).toEqual(['eng']);
  });
});

describe('spaces', () => {
  it('sorts by order then name', async () => {
    await store.createSpace('zeta', 'Zeta');
    await store.createSpace('alpha', 'Alpha');
    await store.createSpace('first', 'First', undefined, 1);
    expect((await store.listSpaces()).map((space) => space.slug)).toEqual([
      'first',
      'alpha',
      'zeta',
    ]);
  });

  it('writes a stable space file', async () => {
    await store.createSpace('eng', 'Engineering', 'E', 2);
    expect(await readFileAt(dir, 'eng/_space.yml')).toBe('name: Engineering\nicon: "E"\norder: 2\n');
  });

  it('rejects a duplicate slug', async () => {
    await store.createSpace('eng', 'Engineering');
    expect(await codeOf(() => store.createSpace('eng', 'Again'))).toBe('CONFLICT');
  });

  it('rejects an invalid slug', async () => {
    expect(await codeOf(() => store.createSpace('nested/slug', 'X'))).toBe('VALIDATION');
    expect(await codeOf(() => store.createSpace('_reserved', 'X'))).toBe('VALIDATION');
    expect(await codeOf(() => store.createSpace('..', 'X'))).toBe('VALIDATION');
    expect(await codeOf(() => store.createSpace('docs', ''))).toBe('VALIDATION');
  });

  it('rejects a new slug that is not url safe', async () => {
    expect(await codeOf(() => store.createSpace('My Docs', 'X'))).toBe('VALIDATION');
    expect(await codeOf(() => store.createSpace('Docs', 'X'))).toBe('VALIDATION');
    expect(await codeOf(() => store.createSpace('-docs', 'X'))).toBe('VALIDATION');
  });

  it('still reads a space directory that was created by hand', async () => {
    await writeFileAt(dir, 'My Docs/index.md', '# Notes\n');
    const slugs = (await store.listSpaces()).map((space) => space.slug);
    expect(slugs).toContain('My Docs');
    expect((await store.getSpace('My Docs')).slug).toBe('My Docs');
  });

  it('falls back to a name derived from the directory', async () => {
    await writeFileAt(dir, 'my-notes/index.md', '# Notes\n');
    expect((await store.listSpaces())[0]).toEqual({ slug: 'my-notes', name: 'My notes' });
  });

  it('reports a missing space as not found', async () => {
    expect(await codeOf(() => store.getSpace('nope'))).toBe('NOT_FOUND');
  });
});

describe('createPage', () => {
  beforeEach(async () => {
    await store.init();
  });

  it('writes a leaf file', async () => {
    const page = await store.createPage({ path: 'docs/guide', title: 'Guide' });
    expect(page.path).toBe('docs/guide');
    expect(page.filePath.endsWith('docs/guide.md')).toBe(true);
    expect(await exists(dir, 'docs/guide.md')).toBe(true);
  });

  it('stores tags, props, icon and order', async () => {
    const page = await store.createPage({
      path: 'docs/deploy',
      title: 'Deploy',
      markdown: '# Deploy\n',
      icon: 'D',
      tags: ['ops'],
      order: 3,
      props: { status: 'live' },
    });
    expect(page.tags).toEqual(['ops']);
    expect(page.props).toEqual({ status: 'live' });
    expect(page.icon).toBe('D');
    expect(page.order).toBe(3);
    expect(page.markdown).toBe('# Deploy');
  });

  it('promotes a leaf parent to a directory', async () => {
    const parent = await store.createPage({ path: 'docs/guide', title: 'Guide' });
    await store.createPage({ path: 'docs/guide/setup', title: 'Setup' });
    expect(await exists(dir, 'docs/guide.md')).toBe(false);
    expect(await exists(dir, 'docs/guide/index.md')).toBe(true);
    expect(await exists(dir, 'docs/guide/setup.md')).toBe(true);
    const reloaded = await store.getPageById(parent.id);
    expect(reloaded.path).toBe('docs/guide');
    expect(reloaded.hasChildren).toBe(true);
  });

  it('creates missing ancestors and promotes an existing leaf on the way', async () => {
    const middle = await store.createPage({ path: 'docs/a', title: 'A' });
    await store.createPage({ path: 'docs/a/b/c/d', title: 'D' });
    expect(await exists(dir, 'docs/a/index.md')).toBe(true);
    expect(await exists(dir, 'docs/a/b/index.md')).toBe(true);
    expect(await exists(dir, 'docs/a/b/c/index.md')).toBe(true);
    expect(await exists(dir, 'docs/a/b/c/d.md')).toBe(true);
    expect((await store.getPageById(middle.id)).path).toBe('docs/a');
    expect((await store.getPageByPath('docs/a/b')).title).toBe('B');
  });

  it('creates the space when it is missing', async () => {
    await store.createPage({ path: 'eng/runbooks', title: 'Runbooks' });
    expect(await exists(dir, 'eng/_space.yml')).toBe(true);
    expect(await exists(dir, 'eng/index.md')).toBe(true);
  });

  it('rejects a taken path', async () => {
    await store.createPage({ path: 'docs/guide', title: 'Guide' });
    expect(await codeOf(() => store.createPage({ path: 'docs/guide', title: 'Other' }))).toBe(
      'CONFLICT',
    );
  });

  it('rejects a path that escapes the content root', async () => {
    expect(await codeOf(() => store.createPage({ path: '../evil', title: 'Evil' }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(() => store.createPage({ path: 'docs/../../evil', title: 'Evil' }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(() => store.createPage({ path: '/etc/passwd', title: 'Evil' }))).toBe(
      'VALIDATION',
    );
  });
});

describe('getTree', () => {
  it('nests children and sorts siblings by order then title', async () => {
    await store.init();
    await store.createPage({ path: 'docs/beta', title: 'Beta' });
    await store.createPage({ path: 'docs/alpha', title: 'Alpha' });
    await store.createPage({ path: 'docs/first', title: 'Zzz', order: 1 });
    await store.createPage({ path: 'docs/alpha/child', title: 'Child' });

    const tree = await store.getTree();
    expect(tree).toHaveLength(1);
    const root = tree[0]?.tree ?? [];
    expect(root.map((node) => node.path)).toEqual(['docs']);
    const children = root[0]?.children ?? [];
    expect(children.map((node) => node.title)).toEqual(['Zzz', 'Alpha', 'Beta']);
    expect(children[1]?.children.map((node) => node.path)).toEqual(['docs/alpha/child']);
  });
});

describe('updatePage', () => {
  beforeEach(async () => {
    await store.init();
  });

  it('bumps updated when a field changes', async () => {
    const page = await store.createPage({ path: 'docs/guide', title: 'Guide' });
    const next = await store.updatePage(page.id, { title: 'Guide v2' });
    expect(next.title).toBe('Guide v2');
    expect(next.created).toBe(page.created);
    expect(Date.parse(next.updated)).toBeGreaterThan(Date.parse(page.updated));
  });

  it('clears the icon and the order with null', async () => {
    const page = await store.createPage({
      path: 'docs/guide',
      title: 'Guide',
      icon: 'G',
      order: 5,
    });
    const next = await store.updatePage(page.id, { icon: null, order: null });
    expect(next.icon).toBeUndefined();
    expect(next.order).toBeUndefined();
    expect(await readFileAt(dir, 'docs/guide.md')).not.toContain('icon:');
  });

  it('replaces tags and props wholesale', async () => {
    const page = await store.createPage({
      path: 'docs/guide',
      title: 'Guide',
      tags: ['a', 'b'],
      props: { x: '1' },
    });
    const next = await store.updatePage(page.id, { tags: ['c'], props: { y: '2' } });
    expect(next.tags).toEqual(['c']);
    expect(next.props).toEqual({ y: '2' });
  });

  it('renames a leaf and keeps the id', async () => {
    const page = await store.createPage({ path: 'docs/guide', title: 'Guide' });
    const moved = await store.updatePage(page.id, { path: 'docs/handbook' });
    expect(moved.id).toBe(page.id);
    expect(moved.path).toBe('docs/handbook');
    expect(await exists(dir, 'docs/guide.md')).toBe(false);
    expect(await exists(dir, 'docs/handbook.md')).toBe(true);
  });

  it('moves a subtree and preserves every id', async () => {
    const a = await store.createPage({ path: 'docs/a', title: 'A' });
    const b = await store.createPage({ path: 'docs/a/b', title: 'B' });
    const c = await store.createPage({ path: 'docs/a/b/c', title: 'C' });

    const moved = await store.updatePage(a.id, { path: 'docs/z' });
    expect(moved.path).toBe('docs/z');
    expect(moved.id).toBe(a.id);
    expect((await store.getPageById(b.id)).path).toBe('docs/z/b');
    expect((await store.getPageById(c.id)).path).toBe('docs/z/b/c');
    expect(await exists(dir, 'docs/z/index.md')).toBe(true);
    expect(await exists(dir, 'docs/z/b/c.md')).toBe(true);
    expect(await exists(dir, 'docs/a/index.md')).toBe(false);
  });

  it('moves a page under a leaf sibling, promoting it first', async () => {
    await store.createPage({ path: 'docs/x', title: 'X' });
    const y = await store.createPage({ path: 'docs/y', title: 'Y' });
    const moved = await store.updatePage(y.id, { path: 'docs/x/y' });
    expect(moved.path).toBe('docs/x/y');
    expect(await exists(dir, 'docs/x/index.md')).toBe(true);
    expect(await exists(dir, 'docs/x/y.md')).toBe(true);
    expect(await exists(dir, 'docs/y.md')).toBe(false);
  });

  it('demotes the old parent once its last child leaves', async () => {
    await store.createPage({ path: 'docs/a', title: 'A' });
    const b = await store.createPage({ path: 'docs/a/b', title: 'B' });
    await store.updatePage(b.id, { path: 'docs/b' });
    expect(await exists(dir, 'docs/a.md')).toBe(true);
    expect(await exists(dir, 'docs/a/index.md')).toBe(false);
    expect(await exists(dir, 'docs/b.md')).toBe(true);
  });

  it('rejects a move into its own descendant', async () => {
    const a = await store.createPage({ path: 'docs/a', title: 'A' });
    await store.createPage({ path: 'docs/a/b', title: 'B' });
    expect(await codeOf(() => store.updatePage(a.id, { path: 'docs/a/b/deeper' }))).toBe('CONFLICT');
    expect(await exists(dir, 'docs/a/index.md')).toBe(true);
  });

  it('rejects a move onto a taken path', async () => {
    const a = await store.createPage({ path: 'docs/a', title: 'A' });
    await store.createPage({ path: 'docs/b', title: 'B' });
    expect(await codeOf(() => store.updatePage(a.id, { path: 'docs/b' }))).toBe('CONFLICT');
  });

  it('refuses to move a space home page', async () => {
    const home = await store.getPageByPath('docs');
    expect(await codeOf(() => store.updatePage(home.id, { path: 'notes' }))).toBe('CONFLICT');
  });

  it('reports an unknown id as not found', async () => {
    expect(await codeOf(() => store.updatePage('pg_nope', { title: 'x' }))).toBe('NOT_FOUND');
  });

  it('rewrites a hand-written file without frontmatter and keeps the indexed id', async () => {
    await writeFileAt(dir, 'docs/bare.md', '# Bare page\n\nWritten by an agent.\n');
    await store.rebuild();
    const page = await store.getPageByPath('docs/bare');
    expect(page.title).toBe('Bare page');

    // The invented frontmatter is written back, so the id survives a restart.
    const repaired = await readFileAt(dir, 'docs/bare.md');
    expect(repaired).toContain(`id: ${page.id}`);
    expect(repaired).toContain('title: Bare page');
    expect(repaired).toContain('Written by an agent.');

    const updated = await store.updatePage(page.id, { title: 'Repaired' });
    expect(updated.id).toBe(page.id);
    const raw = await readFileAt(dir, 'docs/bare.md');
    expect(raw).toContain(`id: ${page.id}`);
    expect(raw).toContain('title: Repaired');
    expect(raw).toContain('Written by an agent.');
    expect((await store.getPageById(page.id)).path).toBe('docs/bare');
  });

  it('keeps a repaired page id stable across a fresh store over the same directory', async () => {
    await writeFileAt(dir, 'docs/bare.md', '# Bare page\n\nWritten by an agent.\n');
    await store.rebuild();
    const first = await store.getPageByPath('docs/bare');

    const reopened = new ContentStore({ contentDir: dir, logger: silentLogger });
    await reopened.init();
    expect((await reopened.getPageByPath('docs/bare')).id).toBe(first.id);
  });

  it('does not rewrite an already repaired file a second time', async () => {
    await writeFileAt(dir, 'docs/bare.md', '# Bare page\n\nWritten by an agent.\n');
    await store.rebuild();
    const after = await readFileAt(dir, 'docs/bare.md');

    await store.rebuild();
    expect(await readFileAt(dir, 'docs/bare.md')).toBe(after);
  });

  it('leaves the file untouched when the patch changes nothing', async () => {
    const page = await store.createPage({ path: 'docs/guide', title: 'Guide', markdown: 'Body' });
    const before = await readFileAt(dir, 'docs/guide.md');
    await store.updatePage(page.id, { title: 'Guide', markdown: 'Body' });
    expect(await readFileAt(dir, 'docs/guide.md')).toBe(before);
  });
});

describe('deletePage', () => {
  beforeEach(async () => {
    await store.init();
  });

  it('removes a leaf', async () => {
    const page = await store.createPage({ path: 'docs/guide', title: 'Guide' });
    expect(await store.deletePage(page.id)).toEqual(['docs/guide']);
    expect(await exists(dir, 'docs/guide.md')).toBe(false);
    expect(await codeOf(() => store.getPageById(page.id))).toBe('NOT_FOUND');
  });

  it('refuses a non-recursive delete of a page with children', async () => {
    const a = await store.createPage({ path: 'docs/a', title: 'A' });
    await store.createPage({ path: 'docs/a/b', title: 'B' });
    expect(await codeOf(() => store.deletePage(a.id))).toBe('CONFLICT');
    expect(await exists(dir, 'docs/a/index.md')).toBe(true);
  });

  it('removes the whole subtree when recursive', async () => {
    const a = await store.createPage({ path: 'docs/a', title: 'A' });
    await store.createPage({ path: 'docs/a/b', title: 'B' });
    await store.createPage({ path: 'docs/a/b/c', title: 'C' });
    expect(await store.deletePage(a.id, true)).toEqual(['docs/a', 'docs/a/b', 'docs/a/b/c']);
    expect(await exists(dir, 'docs/a/index.md')).toBe(false);
    expect(await store.listPages()).toHaveLength(1);
  });

  it('demotes the parent once the last child is gone', async () => {
    await store.createPage({ path: 'docs/a', title: 'A' });
    const b = await store.createPage({ path: 'docs/a/b', title: 'B' });
    await store.deletePage(b.id);
    expect(await exists(dir, 'docs/a.md')).toBe(true);
    expect(await exists(dir, 'docs/a/index.md')).toBe(false);
  });

  it('keeps the space directory alive', async () => {
    const home = await store.getPageByPath('docs');
    await store.deletePage(home.id, true);
    expect(await exists(dir, 'docs/_space.yml')).toBe(true);
    expect((await store.listSpaces()).map((space) => space.slug)).toEqual(['docs']);
  });
});

describe('raw access', () => {
  beforeEach(async () => {
    await store.init();
  });

  it('reads and writes bytes unchanged', async () => {
    const raw = await store.readRaw('docs/index.md');
    await store.writeRaw('docs/index.md', raw);
    expect(await readFileAt(dir, 'docs/index.md')).toBe(raw);
  });

  it('keeps a hand-written frontmatter block and completes the required fields', async () => {
    const content = '---\nid: pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V1\ntitle: "yes"\n---\n\nHand written.\n';
    await store.writeRaw('docs/hand.md', content);
    await store.rebuild();
    const page = await store.getPageByPath('docs/hand');
    expect(page.title).toBe('yes');
    expect(page.id).toBe('pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V1');

    // created/updated are required by the contract, so the missing pair is filled in once.
    const raw = await readFileAt(dir, 'docs/hand.md');
    expect(raw).toContain('id: pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V1');
    expect(raw).toContain('title: "yes"');
    expect(raw).toContain(`created: ${page.created}`);
    expect(raw).toContain('Hand written.');
  });

  it('leaves a complete file byte identical across a rebuild', async () => {
    const before = await readFileAt(dir, 'docs/index.md');
    await store.rebuild();
    expect(await readFileAt(dir, 'docs/index.md')).toBe(before);
  });

  it('rejects a path that escapes the content root', async () => {
    expect(await codeOf(() => store.readRaw('../../etc/passwd'))).toBe('VALIDATION');
    expect(await codeOf(() => store.readRaw('/etc/passwd'))).toBe('VALIDATION');
    expect(await codeOf(() => store.writeRaw('../escape.md', 'x'))).toBe('VALIDATION');
    expect(await codeOf(() => store.writeRaw('docs/../../escape.md', 'x'))).toBe('VALIDATION');
  });

  it('reports a missing file as not found', async () => {
    expect(await codeOf(() => store.readRaw('docs/missing.md'))).toBe('NOT_FOUND');
  });
});

describe('assets', () => {
  it('stores an attachment under the page id and never overwrites', async () => {
    await store.init();
    const page = await store.getPageByPath('docs');
    const first = await store.saveAsset(page.id, 'diagram.png', new Uint8Array([1, 2, 3]));
    const second = await store.saveAsset(page.id, 'diagram.png', new Uint8Array([4]));
    expect(first.path).toBe(`_assets/${page.id}/diagram.png`);
    expect(second.path).toBe(`_assets/${page.id}/diagram-2.png`);
    expect(first.url).toBe(`/_assets/${page.id}/diagram.png`);
    expect(await exists(dir, `_assets/${page.id}/diagram.png`)).toBe(true);
  });

  it('ignores directories in the filename', async () => {
    await store.init();
    const page = await store.getPageByPath('docs');
    const saved = await store.saveAsset(page.id, '../../evil.png', new Uint8Array([1]));
    expect(saved.path).toBe(`_assets/${page.id}/evil.png`);
  });

  it('keeps attachments out of the page tree', async () => {
    await store.init();
    const page = await store.getPageByPath('docs');
    await store.saveAsset(page.id, 'note.md', new Uint8Array([1]));
    await store.rebuild();
    expect((await store.listPages()).map((item) => item.path)).toEqual(['docs']);
  });
});

describe('external edits', () => {
  it('picks up a file added straight in the repository', async () => {
    await store.init();
    await writeFileAt(dir, 'docs/added.md', '---\ntitle: Added\n---\n\nBody\n');
    await store.rebuild();
    const page = await store.getPageByPath('docs/added');
    expect(page.title).toBe('Added');
    expect(page.markdown).toBe('Body');
  });

  it('keeps the file byte identical when a page is only read', async () => {
    await store.init();
    const raw = '---\nid: pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V1\ntitle: Kept\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nUnchanged.\n';
    await writeFileAt(dir, 'docs/kept.md', raw);
    await store.rebuild();
    const page = await store.getPageByPath('docs/kept');
    const roundTripped = await store.updatePage(page.id, { markdown: page.markdown });
    expect(roundTripped.updated).toBe('2026-01-01T00:00:00.000Z');
    expect(await readFileAt(dir, 'docs/kept.md')).toBe(raw);
  });

  it('parses a file the same way the index does', async () => {
    await store.init();
    const raw = await readFileAt(dir, 'docs/index.md');
    const page = await store.getPageByPath('docs');
    expect(parse(raw).frontmatter.id).toBe(page.id);
  });
});

describe('concurrent writes', () => {
  it('lets only one of two simultaneous creates of the same path win', async () => {
    await store.init();
    const results = await Promise.allSettled([
      store.createPage({ path: 'docs/race', title: 'First' }),
      store.createPage({ path: 'docs/race', title: 'Second' }),
    ]);
    const created = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(failed).toHaveLength(1);

    await store.rebuild();
    const pages = await store.listPages();
    expect(pages.filter((page) => page.path === 'docs/race')).toHaveLength(1);
  });

  it('creates two children of the same leaf parent at once', async () => {
    await store.init();
    await store.createPage({ path: 'docs/parent', title: 'Parent' });
    const results = await Promise.allSettled([
      store.createPage({ path: 'docs/parent/a', title: 'A' }),
      store.createPage({ path: 'docs/parent/b', title: 'B' }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await exists(dir, 'docs/parent/index.md')).toBe(true);
    expect(await exists(dir, 'docs/parent.md')).toBe(false);
  });
});

describe('moving a page with children to a new space', () => {
  it('promotes a subtree to a top-level space', async () => {
    await store.init();
    const parent = await store.createPage({ path: 'docs/team', title: 'Team' });
    await store.createPage({ path: 'docs/team/charter', title: 'Charter' });

    const moved = await store.updatePage(parent.id, { path: 'team' });
    expect(moved.path).toBe('team');
    expect(moved.id).toBe(parent.id);
    expect(await exists(dir, 'team/index.md')).toBe(true);
    expect(await exists(dir, 'team/charter.md')).toBe(true);
    expect(await exists(dir, 'team/_space.yml')).toBe(true);
    expect((await store.getPageByPath('team/charter')).title).toBe('Charter');
  });

  it('leaves no space behind when the destination is taken', async () => {
    await store.init();
    const parent = await store.createPage({ path: 'docs/team', title: 'Team' });
    await store.createPage({ path: 'docs/team/charter', title: 'Charter' });
    await store.createSpace('team', 'Team');

    const before = (await store.listSpaces()).map((space) => space.slug);
    const code = await codeOf(() => store.updatePage(parent.id, { path: 'team' }));
    expect(code).toBe('CONFLICT');
    expect((await store.listSpaces()).map((space) => space.slug)).toEqual(before);
    expect(await exists(dir, 'docs/team/index.md')).toBe(true);
  });
});

describe('reserved path segments', () => {
  it('refuses a dot-prefixed segment the scanner would never index', async () => {
    await store.init();
    expect(await codeOf(() => store.createPage({ path: 'docs/.hidden', title: 'Hidden' }))).toBe(
      'VALIDATION',
    );
    expect(await exists(dir, 'docs/.hidden.md')).toBe(false);
  });
});
