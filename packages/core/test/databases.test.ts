import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  databaseRev,
  newOptionId,
  newPropertyId,
  newRowId,
  newViewId,
  starterDatabase,
  type Database,
  type DbRow,
  type PageId,
} from '@tablinum/shared';
import { ContentStore } from '../src/store.js';
import { parse } from '../src/frontmatter.js';
import {
  databaseEqual,
  readDatabase,
  readPropValue,
  readRowProps,
  readRows,
  rowPropsEqual,
  rowsEqual,
  stringifyDatabase,
  stringifyRows,
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

/** Read the `rows` block back out of a page file on disk. */
async function rowsOnDisk(relFile: string): Promise<DbRow[] | null> {
  const parsed = parse(await readFileAt(dir, relFile));
  return parsed.frontmatter.rows ?? null;
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

describe('stringifyRows and readRows', () => {
  const AT = '2026-01-01T00:00:00.000Z';

  function sampleRow(props: Record<string, unknown> = {}): DbRow {
    return { id: newRowId(), title: 'A row', created: AT, updated: AT, props: props as DbRow['props'] };
  }

  it('survives a round trip through the parser', () => {
    const rows = [sampleRow({ [TEXT]: 'a note', [SELECT]: OPTION }), sampleRow()];
    const parsed = parse(`---\n${stringifyRows(rows)}\n---\n\nbody\n`);
    expect(parsed.frontmatter.rows).toEqual(rows);
  });

  it('writes a list cell on its own lines', () => {
    const multi = newPropertyId();
    const yaml = stringifyRows([sampleRow({ [multi]: ['a', 'b'] })]);
    expect(yaml).toContain('- a');
    const parsed = parse(`---\n${yaml}\n---\n\nbody\n`);
    expect(parsed.frontmatter.rows?.[0]?.props[multi]).toEqual(['a', 'b']);
  });

  it('writes nothing at all when there is no row', () => {
    expect(stringifyRows([])).toBe('');
  });

  it('keeps a title with a colon in it readable back', () => {
    const row = { ...sampleRow(), title: 'Ship: the thing' };
    const parsed = parse(`---\n${stringifyRows([row])}\n---\n\nbody\n`);
    expect(parsed.frontmatter.rows?.[0]?.title).toBe('Ship: the thing');
  });

  it('drops a row with no id, and a second row that repeats an id', () => {
    const id = newRowId();
    const read = readRows(
      [
        { id, title: 'First', created: AT, updated: AT },
        { title: 'No id', created: AT, updated: AT },
        { id, title: 'Twin', created: AT, updated: AT },
      ],
      AT,
    );
    expect(read.value?.map((row) => row.title)).toEqual(['First']);
    expect(read.exact).toBe(false);
  });

  it('names a row the file left untitled, and stamps one the file left undated', () => {
    const read = readRows([{ id: newRowId() }], AT);
    expect(read.value?.[0]?.title).toBe('Untitled');
    expect(read.value?.[0]?.created).toBe(AT);
    expect(read.exact).toBe(false);
  });

  it('reads nothing from an absent block, and refuses one that is not a list', () => {
    expect(readRows(undefined, AT)).toEqual({ value: null, exact: true });
    expect(readRows('nonsense', AT)).toEqual({ value: null, exact: false });
  });
});

describe('databaseEqual, rowPropsEqual and rowsEqual', () => {
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

  it('sees a row list change in the title, the cells or the length', () => {
    const at = '2026-01-01T00:00:00.000Z';
    const row: DbRow = { id: newRowId(), title: 'A', created: at, updated: at, props: {} };
    expect(rowsEqual([row], [{ ...row }])).toBe(true);
    expect(rowsEqual([row], [{ ...row, title: 'B' }])).toBe(false);
    expect(rowsEqual([row], [{ ...row, props: { [TEXT]: 'x' } }])).toBe(false);
    expect(rowsEqual([row], [])).toBe(false);
    expect(rowsEqual(undefined, undefined)).toBe(true);
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

describe('setDatabase with a base revision', () => {
  const OWNER = newPropertyId();
  const DUE = newPropertyId();

  /** The property a writer appends without having seen what the other writer appended. */
  function plus(id: string, name: string): Database {
    const database = sampleDatabase();
    database.properties = [...database.properties, { id, name, type: 'text', options: [] }];
    return database;
  }

  it('keeps both properties when two writers add one from the same base', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const base = databaseRev((await store.getDatabase(id)).database);

    await store.setDatabase(id, plus(OWNER, 'Owner'), base);
    const page = await store.setDatabase(id, plus(DUE, 'Due'), base);

    expect(page.database?.properties.map((entry) => entry.name)).toEqual([
      'Status',
      'Notes',
      'Owner',
      'Due',
    ]);
    expect(await dbOnDisk('docs/tasks.md')).toEqual(page.database);
  });

  it('replaces the schema whole when no base revision is given', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.setDatabase(id, plus(OWNER, 'Owner'));
    const page = await store.setDatabase(id, plus(DUE, 'Due'));
    expect(page.database?.properties.map((entry) => entry.name)).toEqual(['Status', 'Notes', 'Due']);
  });

  it('takes the edit whole when nothing changed since it started', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const base = databaseRev((await store.getDatabase(id)).database);
    const page = await store.setDatabase(id, plus(OWNER, 'Owner'), base);
    expect(page.database?.properties.map((entry) => entry.name)).toEqual([
      'Status',
      'Notes',
      'Owner',
    ]);
  });

  it('refuses two writers that rename the same property differently', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const base = databaseRev((await store.getDatabase(id)).database);

    const mine = sampleDatabase();
    mine.properties[1]!.name = 'Detail';
    const theirs = sampleDatabase();
    theirs.properties[1]!.name = 'Remarks';

    await store.setDatabase(id, mine, base);
    expect(await codeOf(() => store.setDatabase(id, theirs, base))).toBe('CONFLICT');
    expect((await store.getDatabase(id)).database.properties[1]?.name).toBe('Detail');
  });

  it('refuses a base revision it no longer remembers', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.setDatabase(id, plus(OWNER, 'Owner'));
    expect(await codeOf(() => store.setDatabase(id, plus(DUE, 'Due'), 'dbforgotten'))).toBe(
      'CONFLICT',
    );
  });

  it('hands the answer back as a base the next edit can build on', async () => {
    const id = await makeTasksPage();
    const first = await store.setDatabase(id, sampleDatabase());
    const base = databaseRev(first.database!);
    const page = await store.setDatabase(id, plus(OWNER, 'Owner'), base);
    expect(page.database?.properties).toHaveLength(3);
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
  it('takes the block off, and the rows go with it', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.createRow(id, { title: 'Keep me' });

    const page = await store.removeDatabase(id);
    expect(page.database).toBeUndefined();
    expect(await dbOnDisk('docs/tasks.md')).toBeNull();
    expect(await rowsOnDisk('docs/tasks.md')).toBeNull();
  });

  it('is quiet when the page never was a database', async () => {
    const id = await makeTasksPage();
    const page = await store.removeDatabase(id);
    expect(page.database).toBeUndefined();
  });
});

describe('createRow', () => {
  it('writes the row into the database page, not into a page of its own', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Ship it', props: { [SELECT]: OPTION } });

    expect(row.id.startsWith('rw_')).toBe(true);
    expect(row.props[SELECT]).toBe(OPTION);
    const onDisk = await rowsOnDisk('docs/tasks.md');
    expect(onDisk?.map((entry) => entry.title)).toEqual(['Ship it']);
    // The row is a record, so the database page never grew a child.
    const tree = await store.getTree();
    const home = tree.find((space) => space.slug === 'docs')?.tree[0];
    expect(home?.children.find((node) => node.path === 'docs/tasks')?.children).toEqual([]);
  });

  it('names an untitled row', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id);
    expect(row.title).toBe('Untitled');
    expect(row.props).toEqual({});
  });

  it('lets two rows share a title and still tells them apart', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const first = await store.createRow(id, { title: 'Same' });
    const second = await store.createRow(id, { title: 'Same' });
    expect(first.id).not.toBe(second.id);
    expect((await store.getDatabase(id)).rows).toHaveLength(2);
  });

  it('keeps the rows in the order they were added', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.createRow(id, { title: 'One' });
    await store.createRow(id, { title: 'Two' });
    await store.createRow(id, { title: 'Three' });
    const read = await store.getDatabase(id);
    expect(read.rows.map((row) => row.title)).toEqual(['One', 'Two', 'Three']);
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

    const saved = await store.updateRow(id, row.id, { props: { [TEXT]: 'changed' } });
    expect(saved.props).toEqual({ [TEXT]: 'changed', [SELECT]: OPTION });
  });

  it('leaves the other rows of the same database alone', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const first = await store.createRow(id, { title: 'First', props: { [TEXT]: 'one' } });
    await store.createRow(id, { title: 'Second', props: { [TEXT]: 'two' } });

    await store.updateRow(id, first.id, { props: { [TEXT]: 'changed' } });
    const read = await store.getDatabase(id);
    expect(read.rows.map((row) => row.props[TEXT])).toEqual(['changed', 'two']);
  });

  it('clears a cell that is set to null', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Row', props: { [TEXT]: 'note' } });

    const saved = await store.updateRow(id, row.id, { props: { [TEXT]: null } });
    expect(saved.props).toEqual({});
    expect((await rowsOnDisk('docs/tasks.md'))?.[0]?.props).toEqual({});
  });

  it('renames the row', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Old name' });

    const saved = await store.updateRow(id, row.id, { title: 'New name' });
    expect(saved.title).toBe('New name');
    expect(saved.id).toBe(row.id);
  });

  it('moves the row in front of another one', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const first = await store.createRow(id, { title: 'First' });
    await store.createRow(id, { title: 'Second' });
    const third = await store.createRow(id, { title: 'Third' });

    await store.updateRow(id, third.id, { before: first.id });
    const read = await store.getDatabase(id);
    expect(read.rows.map((row) => row.title)).toEqual(['Third', 'First', 'Second']);
  });

  it('moves the row to the end when it lands in front of nothing', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const first = await store.createRow(id, { title: 'First' });
    await store.createRow(id, { title: 'Second' });

    await store.updateRow(id, first.id, { before: null });
    expect((await rowsOnDisk('docs/tasks.md'))?.map((row) => row.title)).toEqual([
      'Second',
      'First',
    ]);
  });

  it('changes a cell and the order in one write', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const first = await store.createRow(id, { title: 'First' });
    const second = await store.createRow(id, { title: 'Second' });

    const saved = await store.updateRow(id, second.id, {
      props: { [TEXT]: 'moved' },
      before: first.id,
    });
    expect(saved.props).toEqual({ [TEXT]: 'moved' });
    const read = await store.getDatabase(id);
    expect(read.rows.map((row) => row.title)).toEqual(['Second', 'First']);
  });

  it('leaves the order alone when the patch says nothing about it', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const first = await store.createRow(id, { title: 'First' });
    await store.createRow(id, { title: 'Second' });

    await store.updateRow(id, first.id, { title: 'Renamed' });
    const read = await store.getDatabase(id);
    expect(read.rows.map((row) => row.title)).toEqual(['Renamed', 'Second']);
  });

  it('drops a select value no option matches', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Row' });

    const saved = await store.updateRow(id, row.id, {
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
        store.updateRow(id, row.id, { props: { pr_00000000000000000000000000: 'ghost' } }),
      ),
    ).toBe('VALIDATION');
  });

  it('reports a row the database does not hold', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    expect(await codeOf(() => store.updateRow(id, newRowId(), { title: 'x' }))).toBe('NOT_FOUND');
  });

  it('refuses a page that is not a database', async () => {
    await store.init();
    const plain = await store.createPage({ path: 'docs/plain', title: 'Plain' });
    expect(await codeOf(() => store.updateRow(plain.id, newRowId(), { title: 'x' }))).toBe(
      'VALIDATION',
    );
  });
});

describe('deleteRow', () => {
  it('takes the row out and leaves the rest in order', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.createRow(id, { title: 'One' });
    const second = await store.createRow(id, { title: 'Two' });
    await store.createRow(id, { title: 'Three' });

    await store.deleteRow(id, second.id);
    const read = await store.getDatabase(id);
    expect(read.rows.map((row) => row.title)).toEqual(['One', 'Three']);
  });

  it('leaves no rows block behind when the last row goes', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    const row = await store.createRow(id, { title: 'Only' });

    await store.deleteRow(id, row.id);
    expect(await rowsOnDisk('docs/tasks.md')).toBeNull();
    expect(await dbOnDisk('docs/tasks.md')).toEqual(sampleDatabase());
  });

  it('reports a row the database does not hold', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    expect(await codeOf(() => store.deleteRow(id, newRowId()))).toBe('NOT_FOUND');
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

  it('keeps its rows when the body is rewritten', async () => {
    const id = await makeTasksPage();
    await store.setDatabase(id, sampleDatabase());
    await store.createRow(id, { title: 'Row', props: { [TEXT]: 'note' } });
    await store.updatePage(id, { markdown: 'Detail.\n' });

    const read = await store.getDatabase(id);
    expect(read.rows[0]?.props[TEXT]).toBe('note');
    expect((await store.getPageById(id)).markdown).toBe('Detail.');
  });

  it('starts from the starter schema, which passes every check', async () => {
    const id = await makeTasksPage();
    const page = await store.setDatabase(id, starterDatabase());
    expect(page.database?.properties).toHaveLength(2);
    expect(page.database?.views).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// board views
// ---------------------------------------------------------------------------

describe('a board view in the file', () => {
  function boardDatabase(): Database {
    const database = sampleDatabase();
    const view = database.views[0];
    if (view === undefined) throw new Error('the sample lost its view');
    view.type = 'board';
    view.groupBy = SELECT;
    return database;
  }

  it('survives a round trip with its layout and its group', () => {
    const database = boardDatabase();
    const raw = parse(`---\n${stringifyDatabase(database)}\n---\n\nbody\n`);
    expect(raw.frontmatter.db).toEqual(database);
  });

  it('writes the group under the view it belongs to', () => {
    expect(stringifyDatabase(boardDatabase())).toContain(`groupBy: ${SELECT}`);
  });

  it('leaves the key out of a view that names no group', () => {
    expect(stringifyDatabase(sampleDatabase())).not.toContain('groupBy');
  });

  it('drops a group that is not a property id, and asks for a rewrite', () => {
    const read = readDatabase({
      properties: [],
      views: [{ id: VIEW, name: 'Board', type: 'board', groupBy: 'Status' }],
    });
    expect(read.value?.views[0]?.groupBy).toBeUndefined();
    expect(read.exact).toBe(false);
  });

  it('drops a view whose layout nobody knows', () => {
    const read = readDatabase({
      properties: [],
      views: [{ id: VIEW, name: 'Gallery', type: 'gallery' }],
    });
    expect(read.value?.views[0]?.type).toBe('table');
    expect(read.exact).toBe(false);
  });

  it('tells two views apart by the group alone', () => {
    const a = boardDatabase();
    const b = boardDatabase();
    const view = b.views[0];
    if (view === undefined) throw new Error('the sample lost its view');
    view.groupBy = TEXT;
    expect(databaseEqual(a, b)).toBe(false);
  });

  it('reaches the page file and comes back off it', async () => {
    const page = await store.createPage({ path: 'docs/tasks', title: 'Tasks' });
    await store.setDatabase(page.id as PageId, boardDatabase());

    expect(await readFileAt(dir, 'docs/tasks.md')).toContain(`groupBy: ${SELECT}`);
    const read = await store.getDatabase(page.id as PageId);
    expect(read.database.views[0]?.type).toBe('board');
    expect(read.database.views[0]?.groupBy).toBe(SELECT);
  });
});
