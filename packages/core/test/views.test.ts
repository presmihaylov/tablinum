import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PageSummary } from '@gitdocs/shared';
import { filtersFromRecord, queryView } from '../src/views.js';
import type { ContentStore } from '../src/store.js';
import { codeOf, makeStore, makeTempDir, removeTempDir } from './helpers.js';

function page(path: string, overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: `pg_${path}`,
    path,
    space: path.split('/')[0] ?? 'docs',
    title: path.split('/').pop() ?? path,
    tags: [],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    props: {},
    filePath: `/tmp/${path}.md`,
    hasChildren: false,
    ...overrides,
  };
}

const rows: PageSummary[] = [
  page('docs/tasks'),
  page('docs/tasks/one', { title: 'One', props: { status: 'done', points: 3 } }),
  page('docs/tasks/two', { title: 'Two', props: { status: 'todo', points: 1 } }),
  page('docs/tasks/three', { title: 'Three', props: { status: 'done', owner: 'ana' } }),
  page('docs/tasks/two/deep', { title: 'Deep', props: { status: 'done' } }),
  page('docs/other', { props: { status: 'done' } }),
];

describe('queryView', () => {
  it('returns only the direct children', () => {
    const result = queryView(rows, { dir: 'docs/tasks' });
    expect(result.rows.map((row) => row.path)).toEqual([
      'docs/tasks/one',
      'docs/tasks/three',
      'docs/tasks/two',
    ]);
  });

  it('unions the prop keys into stable columns', () => {
    expect(queryView(rows, { dir: 'docs/tasks' }).columns).toEqual(['owner', 'points', 'status']);
  });

  it('filters on a prop value', () => {
    const result = queryView(rows, { dir: 'docs/tasks', where: [{ key: 'status', value: 'done' }] });
    expect(result.rows.map((row) => row.title)).toEqual(['One', 'Three']);
  });

  it('applies every filter clause', () => {
    const where = filtersFromRecord({ status: 'done', owner: 'ana' });
    expect(queryView(rows, { dir: 'docs/tasks', where }).rows.map((row) => row.title)).toEqual([
      'Three',
    ]);
  });

  it('matches a built-in key when no prop shadows it', () => {
    const result = queryView(rows, { dir: 'docs/tasks', where: [{ key: 'title', value: 'two' }] });
    expect(result.rows.map((row) => row.path)).toEqual(['docs/tasks/two']);
  });

  it('sorts by a prop and puts rows without it last', () => {
    const result = queryView(rows, { dir: 'docs/tasks', sort: 'points' });
    expect(result.rows.map((row) => row.title)).toEqual(['Two', 'One', 'Three']);
  });

  it('reverses with order desc', () => {
    const result = queryView(rows, { dir: 'docs/tasks', sort: 'points', order: 'desc' });
    expect(result.rows.map((row) => row.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('sorts by explicit order then title by default', () => {
    const ordered = [
      page('a/dir'),
      page('a/dir/x', { title: 'X' }),
      page('a/dir/y', { title: 'Y', order: 1 }),
      page('a/dir/z', { title: 'Z', order: 0 }),
    ];
    expect(queryView(ordered, { dir: 'a/dir' }).rows.map((row) => row.title)).toEqual([
      'Z',
      'Y',
      'X',
    ]);
  });

  it('returns nothing for a directory with no children', () => {
    expect(queryView(rows, { dir: 'docs/other' })).toEqual({ columns: [], rows: [] });
  });
});

describe('store.queryView', () => {
  let dir = '';
  let store: ContentStore;

  beforeEach(async () => {
    dir = await makeTempDir();
    store = makeStore(dir);
    await store.init();
    await store.createPage({ path: 'docs/tasks', title: 'Tasks' });
    await store.createPage({
      path: 'docs/tasks/ship',
      title: 'Ship it',
      props: { status: 'done', points: 5 },
    });
    await store.createPage({
      path: 'docs/tasks/plan',
      title: 'Plan it',
      props: { status: 'todo' },
    });
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('reads props straight from the files', async () => {
    const result = await store.queryView({ dir: 'docs/tasks' });
    expect(result.columns).toEqual(['points', 'status']);
    expect(result.rows.map((row) => row.title)).toEqual(['Plan it', 'Ship it']);
  });

  it('filters', async () => {
    const result = await store.queryView({
      dir: 'docs/tasks',
      where: [{ key: 'status', value: 'done' }],
    });
    expect(result.rows.map((row) => row.title)).toEqual(['Ship it']);
  });

  it('reports an unknown directory as not found', async () => {
    expect(await codeOf(() => store.queryView({ dir: 'docs/nope' }))).toBe('NOT_FOUND');
  });
});
