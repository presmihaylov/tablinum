import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  newOptionId,
  newPropertyId,
  newViewId,
  starterDatabase,
  type Database,
  type PageId,
} from '@tablinum/shared';
import { ContentStore } from '../src/store.js';
import { parse } from '../src/frontmatter.js';
import {
  databaseEqual,
  readDatabase,
  readPropValue,
  readRowProps,
  rowPropsEqual,
  stringifyDatabase,
  stringifyRowProps,
} from '../src/db-frontmatter.js';
import { codeOf, makeStore, makeTempDir, readFileAt, removeTempDir } from './helpers.js';

let dir = '';
let store: ContentStore;

beforeEach(async () => {
  dir = await makeTempDir();
  store = makeStore(dir);
});

afterEach(async () => {
  await removeTempDir(dir);
});

const OPTION = newOptionId();
const SELECT = newPropertyId();
const TEXT = newPropertyId();
const VIEW = newViewId();

function sampleDatabase(): Database {
  return {
    properties: [
      { id: SELECT, name: 'Status', type: 'select', options: [{ id: OPTION, name: 'Todo', color: 'blue' }] },
      { id: TEXT, name: 'Notes', type: 'text', options: [] },
    ],
    views: [
      {
        id: VIEW,
        name: 'Table',
        type: 'table',
        filters: [{ property: SELECT, op: 'is', value: OPTION }],
        sorts: [{ property: TEXT, direction: 'desc' }],
        hidden: [TEXT],
      },
    ],
  };
}

/** Read a `db` block back out of a page file on disk. */
async function dbOnDisk(relFile: string): Promise<Database | null> {
  const parsed = parse(await readFileAt(dir, relFile));
  return parsed.frontmatter.db ?? null;
}

// ---------------------------------------------------------------------------
// the frontmatter codec
// ---------------------------------------------------------------------------

describe('stringifyDatabase and readDatabase', () => {
  it('survives a round trip with every part of a view intact', () => {
    const database = sampleDatabase();
    const raw = parse(`---\n${stringifyDatabase(database)}\n---\n\nbody\n`);
    expect(raw.frontmatter.db).toEqual(database);
  });

  it('writes a number format and reads it back', () => {
    const id = newPropertyId();
    const database: Database = {
      properties: [{ id, name: 'Cost', type: 'number', options: [], format: 'currency' }],
      views: [{ id: VIEW, name: 'Table', type: 'table', filters: [], sorts: [], hidden: [] }],
    };
    const parsed = parse(`---\n${stringifyDatabase(database)}\n---\n\nbody\n`);
    expect(parsed.frontmatter.db?.properties[0]?.format).toBe('currency');
  });

  it('quotes a name that would otherwise change meaning as YAML', () => {
    const database = sampleDatabase();
    const named: Database = {
      ...database,
      properties: [{ ...database.properties[0]!, name: 'Yes: no # really' }],
    };
    const parsed = parse(`---\n${stringifyDatabase(named)}\n---\n\nbody\n`);
    expect(parsed.frontmatter.db?.properties[0]?.name).toBe('Yes: no # really');
  });
});

describe('readDatabase repair', () => {
  it('reads nothing from a page that has no block', () => {
    expect(readDatabase(undefined)).toEqual({ value: null, exact: true });
    expect(readDatabase(null)).toEqual({ value: null, exact: true });
  });

  it('gives a database with no view a default one back', () => {
    const read = readDatabase({ properties: [], views: [] });
    expect(read.exact).toBe(false);
    expect(read.value?.views).toHaveLength(1);
    expect(read.value?.views[0]?.name).toBe('Table');
  });

  it('drops a property with no id and keeps the ones beside it', () => {
    const read = readDatabase({
      properties: [{ name: 'Broken', type: 'text' }, { id: TEXT, name: 'Notes', type: 'text' }],
      views: [{ id: VIEW, name: 'Table', type: 'table' }],
    });
    expect(read.exact).toBe(false);
    expect(read.value?.properties.map((property) => property.id)).toEqual([TEXT]);
  });

  it('drops a second property that repeats an id', () => {
    const read = readDatabase({
      properties: [
        { id: TEXT, name: 'First', type: 'text' },
        { id: TEXT, name: 'Second', type: 'text' },
      ],
      views: [{ id: VIEW, name: 'Table', type: 'table' }],
    });
    expect(read.exact).toBe(false);
    expect(read.value?.properties).toHaveLength(1);
    expect(read.value?.properties[0]?.name).toBe('First');
  });

  it('drops options from a type that cannot hold them', () => {
    const read = readDatabase({
      properties: [{ id: TEXT, name: 'Notes', type: 'text', options: [{ id: OPTION, name: 'x' }] }],
      views: [{ id: VIEW, name: 'Table', type: 'table' }],
    });
    expect(read.exact).toBe(false);
    expect(read.value?.properties[0]?.options).toEqual([]);
  });

  it('gives an option with an unknown colour a grey one', () => {
    const read = readDatabase({
      properties: [
        { id: SELECT, name: 'Status', type: 'select', options: [{ id: OPTION, name: 'Todo', color: 'chartreuse' }] },
      ],
      views: [{ id: VIEW, name: 'Table', type: 'table' }],
    });
    expect(read.value?.properties[0]?.options[0]?.color).toBe('gray');
  });

  it('reads nothing usable out of a block that is not a mapping', () => {
    expect(readDatabase('nonsense')).toEqual({ value: null, exact: false });
  });
});

describe('readRowProps', () => {
  it('keeps every kind of cell a property can hold', () => {
    const read = readRowProps({ [TEXT]: 'note', [SELECT]: OPTION });
    expect(read).toEqual({ value: { [TEXT]: 'note', [SELECT]: OPTION }, exact: true });
  });

  it('drops a key that is not a property id', () => {
    const read = readRowProps({ status: 'live', [TEXT]: 'kept' });
    expect(read.exact).toBe(false);
    expect(read.value).toEqual({ [TEXT]: 'kept' });
  });

  it('reads a YAML date back as the day it names', () => {
    expect(readPropValue(new Date('2026-08-12T00:00:00.000Z'))).toBe('2026-08-12');
  });

  it('refuses a number that is not finite', () => {
    expect(readPropValue(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('reads nothing from an empty block', () => {
    expect(readRowProps({})).toEqual({ value: null, exact: true });
  });
});

describe('stringifyRowProps', () => {
  it('survives a round trip through the parser', () => {
    const props = { [TEXT]: 'a note', [SELECT]: OPTION };
    const parsed = parse(`---\n${stringifyRowProps(props)}\n---\n\nbody\n`);
    expect(parsed.frontmatter.props).toEqual(props);
  });

  it('writes a list on its own lines', () => {
    const multi = newPropertyId();
    const yaml = stringifyRowProps({ [multi]: ['a', 'b'] });
    expect(yaml).toContain('- a');
    const parsed = parse(`---\n${yaml}\n---\n\nbody\n`);
    expect(parsed.frontmatter.props?.[multi]).toEqual(['a', 'b']);
  });
});

describe('databaseEqual and rowPropsEqual', () => {
  it('sees two copies of the same database as equal', () => {
    expect(databaseEqual(sampleDatabase(), sampleDatabase())).toBe(true);
    expect(databaseEqual(undefined, undefined)).toBe(true);
    expect(databaseEqual(sampleDatabase(), undefined)).toBe(false);
  });

  it('sees a renamed property as a change', () => {
    const changed = sampleDatabase();
    changed.properties[0]!.name = 'State';
    expect(databaseEqual(sampleDatabase(), changed)).toBe(false);
  });

  it('compares row cells by value, not by key order', () => {
    expect(rowPropsEqual({ [TEXT]: 'a', [SELECT]: OPTION }, { [SELECT]: OPTION, [TEXT]: 'a' })).toBe(
      true,
    );
    expect(rowPropsEqual({ [TEXT]: 'a' }, { [TEXT]: 'b' })).toBe(false);
    expect(rowPropsEqual(undefined, undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

async function makeTasksPage(): Promise<PageId> {
  await store.init();
  const page = await store.createPage({ path: 'docs/tasks', title: 'Tasks' });
  return page.id;
}

describe('setDatabase', () => {
  it('turns a page into a database and writes the block to its file', async () => {
    const id = await makeTasksPage();
    const page = await store.setDatabase(id, sampleDatabase());
    expect(page.database).toEqual(sampleDatabase());
    expect(await dbOnDisk('docs/tasks.md')).toEqual(sampleDatabase());
  });

  it('keeps the page body byte for byte', async () => {
    await store.init();
    const page = await store.createPage({ path: 'docs/tasks', title: 'Tasks', markdown: '# Plan\n\nText.\n' });
    await store.setDatabase(page.id, sampleDatabase());
    const saved = await store.getPageById(page.id);
    expect(saved.markdown).toBe('# Plan\n\nText.');
  });

  it('refuses a database with no view', async () => {
    const id = await makeTasksPage();
    const broken = { ...sampleDatabase(), views: [] };
    expect(await codeOf(() => store.setDatabase(id, broken))).toBe('VALIDATION');
  });

  it('replaces a schema that is already there', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const renamed = sampleDatabase();
    renamed.properties[1]!.name = 'Detail';
    const page = await store.setDatabase(id, renamed);
    expect(page.database?.properties[1]?.name).toBe('Detail');
  });

  it('reports a page that is not there', async () => {
    await store.init();
    expect(
      await codeOf(() => store.setDatabase('pg_00000000000000000000000000', sampleDatabase())),
    ).toBe('NOT_FOUND');
  });
});

describe('getDatabase', () => {
  it('reads the schema and every row back', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.createRow(id, { title: 'First', props: { [TEXT]: 'one' } });
    await store.createRow(id, { title: 'Second', props: { [TEXT]: 'two' } });

    const read = await store.getDatabase(id);
    expect(read.database).toEqual(sampleDatabase());
    expect(read.rows.map((row) => row.title)).toEqual(['First', 'Second']);
    expect(read.rows[0]?.props[TEXT]).toBe('one');
  });

  it('refuses a page that carries no database', async () => {
    const id = await makeTasksPage();
    expect(await codeOf(() => store.getDatabase(id))).toBe('VALIDATION');
  });

  it('drops a cell whose property the schema no longer has', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.createRow(id, { title: 'Row', props: { [TEXT]: 'note' } });
    await store.setDatabase(id, {
      ...sampleDatabase(),
      properties: [sampleDatabase().properties[0]!],
    });
    const read = await store.getDatabase(id);
    expect(read.rows[0]?.props).toEqual({});
  });
});

describe('removeDatabase', () => {
  it('takes the block off and leaves the rows as ordinary pages', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Keep me' });

    const page = await store.removeDatabase(id);
    expect(page.database).toBeUndefined();
    expect(await dbOnDisk('docs/tasks/index.md')).toBeNull();
    const kept = await store.getPageById(row.id);
    expect(kept.title).toBe('Keep me');
  });

  it('is quiet when the page never was a database', async () => {
    const id = await makeTasksPage();
    const page = await store.removeDatabase(id);
    expect(page.database).toBeUndefined();
  });
});

describe('createRow', () => {
  it('writes the row as a child page with its cells in the frontmatter', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Ship it', props: { [SELECT]: OPTION } });

    expect(row.path).toBe('docs/tasks/ship-it');
    expect(row.props[SELECT]).toBe(OPTION);
    const parsed = parse(await readFileAt(dir, 'docs/tasks/ship-it.md'));
    expect(parsed.frontmatter.props).toEqual({ [SELECT]: OPTION });
  });

  it('names an untitled row and still gives it a path', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id);
    expect(row.title).toBe('Untitled');
    expect(row.props).toEqual({});
  });

  it('lets two rows share a title', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const first = await store.createRow(id, { title: 'Same' });
    const second = await store.createRow(id, { title: 'Same' });
    expect(first.path).not.toBe(second.path);
  });

  it('drops a cell the schema does not describe', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, {
      title: 'Row',
      props: { pr_00000000000000000000000000: 'ghost', [TEXT]: 'kept' },
    });
    expect(row.props).toEqual({ [TEXT]: 'kept' });
  });

  it('refuses a page that is not a database', async () => {
    const id = await makeTasksPage();
    expect(await codeOf(() => store.createRow(id, { title: 'Row' }))).toBe('VALIDATION');
  });
});

describe('updateRow', () => {
  it('changes one cell and leaves the others alone', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, {
      title: 'Row',
      props: { [TEXT]: 'note', [SELECT]: OPTION },
    });

    const saved = await store.updateRow(row.id, { props: { [TEXT]: 'changed' } });
    expect(saved.props).toEqual({ [TEXT]: 'changed', [SELECT]: OPTION });
  });

  it('clears a cell that is set to null', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Row', props: { [TEXT]: 'note' } });

    const saved = await store.updateRow(row.id, { props: { [TEXT]: null } });
    expect(saved.props).toEqual({});
    const parsed = parse(await readFileAt(dir, `${row.path}.md`));
    expect(parsed.frontmatter.props).toBeUndefined();
  });

  it('renames the row without moving its file', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Old name' });

    const saved = await store.updateRow(row.id, { title: 'New name' });
    expect(saved.title).toBe('New name');
    expect(saved.path).toBe(row.path);
  });

  it('drops a select value no option matches', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Row' });

    const saved = await store.updateRow(row.id, {
      props: { [SELECT]: 'op_00000000000000000000000000' },
    });
    expect(saved.props).toEqual({});
  });

  it('refuses a property the database does not have', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Row' });

    expect(
      await codeOf(() =>
        store.updateRow(row.id, { props: { pr_00000000000000000000000000: 'ghost' } }),
      ),
    ).toBe('VALIDATION');
  });

  it('refuses a page whose parent is not a database', async () => {
    await store.init();
    const parent = await store.createPage({ path: 'docs/plain', title: 'Plain' });
    const child = await store.createPage({ path: 'docs/plain/child', title: 'Child' });
    expect(await codeOf(() => store.updateRow(child.id, { title: 'x' }))).toBe('VALIDATION');
    expect(parent.database).toBeUndefined();
  });
});

describe('a database page under ordinary edits', () => {
  it('keeps its schema when the body is rewritten', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.updatePage(id, { markdown: 'New body.\n' });

    const page = await store.getPageById(id);
    expect(page.database).toEqual(sampleDatabase());
  });

  it('keeps the cells of a row when the body of that row is rewritten', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Row', props: { [TEXT]: 'note' } });
    await store.updatePage(row.id, { markdown: 'Detail.\n' });

    const read = await store.getDatabase(id);
    expect(read.rows[0]?.props[TEXT]).toBe('note');
  });

  it('starts from the starter schema, which passes every check', async () => {
    const id = await makeTasksPage();
    const page = await store.setDatabase(id, starterDatabase());
    expect(page.database?.properties).toHaveLength(2);
    expect(page.database?.views).toHaveLength(1);
  });
});
