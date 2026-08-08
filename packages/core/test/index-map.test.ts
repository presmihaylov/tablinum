import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IndexMap } from '../src/index-map.js';
import { silentLogger } from '../src/logger.js';
import { scanPageFiles } from '../src/scan.js';
import { makeTempDir, removeTempDir, writeFileAt } from './helpers.js';

const ID = 'pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V1';
const OTHER = 'pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V2';

function file(id: string, title: string): string {
  return `---\nid: ${id}\ntitle: ${title}\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nbody\n`;
}

let dir = '';

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

function makeIndex(): IndexMap {
  return new IndexMap({ contentDir: dir, logger: silentLogger });
}

describe('scanPageFiles', () => {
  it('finds page files inside spaces and ignores everything else', async () => {
    await writeFileAt(dir, 'docs/index.md', file(ID, 'Docs'));
    await writeFileAt(dir, 'docs/guide.md', file(OTHER, 'Guide'));
    await writeFileAt(dir, 'docs/_draft.md', 'hidden');
    await writeFileAt(dir, 'docs/notes.txt', 'not a page');
    await writeFileAt(dir, 'README.md', 'root file');
    await writeFileAt(dir, '_assets/pg_A/shot.md', 'attachment');
    await writeFileAt(dir, '.git/config.md', 'git internals');

    const files = await scanPageFiles(dir);
    expect(files.map((entry) => entry.path)).toEqual(['docs', 'docs/guide']);
    expect(files[0]?.isIndex).toBe(true);
    expect(files[1]?.isIndex).toBe(false);
  });
});

describe('IndexMap', () => {
  it('maps ids and paths and flags parents', async () => {
    await writeFileAt(dir, 'docs/index.md', file(ID, 'Docs'));
    await writeFileAt(dir, 'docs/guide.md', file(OTHER, 'Guide'));

    const index = makeIndex();
    await index.ensureBuilt();
    expect(index.size).toBe(2);
    expect(index.byId(ID)?.path).toBe('docs');
    expect(index.byPath('docs/guide')?.id).toBe(OTHER);
    expect(index.byId(ID)?.hasChildren).toBe(true);
    expect(index.byId(OTHER)?.hasChildren).toBe(false);
    expect(index.filePathById(OTHER)?.endsWith('docs/guide.md')).toBe(true);
  });

  it('lists children and descendants', async () => {
    await writeFileAt(dir, 'docs/index.md', file(ID, 'Docs'));
    await writeFileAt(dir, 'docs/a/index.md', file('pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V3', 'A'));
    await writeFileAt(dir, 'docs/a/b.md', file('pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V4', 'B'));

    const index = makeIndex();
    await index.ensureBuilt();
    expect(index.childrenOf('docs').map((page) => page.path)).toEqual(['docs/a']);
    expect(index.descendantsOf('docs').map((page) => page.path)).toEqual(['docs/a', 'docs/a/b']);
  });

  it('drops the second of two files that share an id', async () => {
    await writeFileAt(dir, 'docs/index.md', file(ID, 'Docs'));
    await writeFileAt(dir, 'docs/copy.md', file(ID, 'Copy'));

    const index = makeIndex();
    await index.ensureBuilt();
    expect(index.duplicateIds).toEqual([ID]);
    expect(index.byId(ID)?.path).toBe('docs');
    // The shadowed file must not be listed: every lookup goes through the id, so a listed page
    // that byId cannot resolve is unreadable and undeletable through the API.
    expect(index.byPath('docs/copy')).toBeUndefined();
    expect(index.all().map((page) => page.path)).toEqual(['docs']);
    expect(index.size).toBe(1);
  });

  it('drops the leaf file when a page path has both foo.md and foo/index.md', async () => {
    await writeFileAt(dir, 'docs/index.md', file(ID, 'Docs'));
    await writeFileAt(dir, 'docs/a.md', file(OTHER, 'Leaf'));
    await writeFileAt(dir, 'docs/a/index.md', file('pg_01JBQ7Z8K3M4N5P6Q7R8S9T0V5', 'Dir'));

    const index = makeIndex();
    await index.ensureBuilt();
    expect(index.all().map((page) => page.path)).toEqual(['docs', 'docs/a']);
    expect(index.byPath('docs/a')?.isIndex).toBe(true);
    expect(index.byId(OTHER)).toBeUndefined();
    // One record per path, or childrenOf reports the same child twice.
    expect(index.childrenOf('docs').map((page) => page.path)).toEqual(['docs/a']);
  });

  it('gives a file with no id a stable generated id', async () => {
    await writeFileAt(dir, 'docs/index.md', '# Docs\n');
    const index = makeIndex();
    await index.ensureBuilt();
    const first = index.byPath('docs')?.id ?? '';
    expect(first.startsWith('pg_')).toBe(true);
    await index.rebuild();
    expect(index.byPath('docs')?.id).toBe(first);
    expect(index.byPath('docs')?.repaired).toBe(true);
  });

  it('picks up a file added after the first build', async () => {
    await writeFileAt(dir, 'docs/index.md', file(ID, 'Docs'));
    const index = makeIndex();
    await index.ensureBuilt();
    await writeFileAt(dir, 'docs/new.md', file(OTHER, 'New'));
    index.markStale();
    await index.ensureBuilt();
    expect(index.has('docs/new')).toBe(true);
  });
});
