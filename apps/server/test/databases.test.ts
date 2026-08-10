import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DatabaseResponseSchema,
  ErrorBodySchema,
  OkResponseSchema,
  PageResponseSchema,
  RowResponseSchema,
  newOptionId,
  newPropertyId,
  newViewId,
  type Database,
} from '@tablinum/shared';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

function headers(): Record<string, string> {
  return harness.authHeaders();
}

const OPTION = newOptionId();
const SELECT = newPropertyId();
const TEXT = newPropertyId();
const VIEW = newViewId();

function sampleDatabase(): Database {
  return {
    properties: [
      {
        id: SELECT,
        name: 'Status',
        type: 'select',
        options: [{ id: OPTION, name: 'Todo', color: 'blue' }],
      },
      { id: TEXT, name: 'Notes', type: 'text', options: [] },
    ],
    views: [{ id: VIEW, name: 'Table', type: 'table', filters: [], sorts: [], hidden: [] }],
  };
}

/** A plain page under the seeded space, ready to be turned into a database. */
async function makePage(path = 'eng/tasks', title = 'Tasks'): Promise<string> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: headers(),
    payload: { path, title },
  });
  expect(created.statusCode).toBe(201);
  return bodyOf(created, PageResponseSchema).page.id;
}

async function setDatabase(id: string, database?: Database) {
  return harness.app.inject({
    method: 'PUT',
    url: `/api/v1/pages/${id}/database`,
    headers: headers(),
    payload: database === undefined ? {} : { database },
  });
}

async function createRow(id: string, payload: Record<string, unknown> = {}) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/v1/pages/${id}/database/rows`,
    headers: headers(),
    payload,
  });
}

async function readDatabase(id: string) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/pages/${id}/database`,
    headers: headers(),
  });
}

describe('PUT /pages/:id/database', () => {
  it('turns a plain page into a database with the starter schema', async () => {
    await seed(harness);
    const id = await makePage();

    const response = await setDatabase(id);
    expect(response.statusCode).toBe(200);
    const page = bodyOf(response, PageResponseSchema).page;
    expect(page.database?.properties).toHaveLength(2);
    expect(page.database?.views).toHaveLength(1);
    expect(page.database?.views[0]?.type).toBe('table');
  });

  it('writes the schema into the page file, and nowhere else', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());

    const raw = await readFile(join(harness.contentDir, 'eng/tasks.md'), 'utf8');
    expect(raw).toContain('db:');
    expect(raw).toContain('name: Status');
    expect(raw).toContain(SELECT);
  });

  it('replaces a schema that is already there', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());

    const renamed = sampleDatabase();
    renamed.properties[1]!.name = 'Detail';
    const response = await setDatabase(id, renamed);
    expect(bodyOf(response, PageResponseSchema).page.database?.properties[1]?.name).toBe('Detail');
  });

  it('refuses a database with no view', async () => {
    await seed(harness);
    const id = await makePage();

    const response = await setDatabase(id, { ...sampleDatabase(), views: [] });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('refuses a property type it does not know', async () => {
    await seed(harness);
    const id = await makePage();

    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/pages/${id}/database`,
      headers: headers(),
      payload: {
        database: {
          properties: [{ id: TEXT, name: 'Notes', type: 'sparkline', options: [] }],
          views: sampleDatabase().views,
        },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reports a page that is not there', async () => {
    await seed(harness);
    const response = await setDatabase('pg_00000000000000000000000000');
    expect(response.statusCode).toBe(404);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('NOT_FOUND');
  });

  it('commits the change to git', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await harness.git.flush();

    const log = await harness.git.history('eng/tasks.md', 10);
    expect(log.some((entry) => entry.message.includes('database'))).toBe(true);
  });
});

describe('GET /pages/:id/database', () => {
  it('reads the schema and the rows back', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'First', props: { [TEXT]: 'one' } });
    await createRow(id, { title: 'Second', props: { [SELECT]: OPTION } });

    const response = await readDatabase(id);
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response, DatabaseResponseSchema);
    expect(body.database.properties.map((property) => property.name)).toEqual(['Status', 'Notes']);
    expect(body.rows.map((row) => row.title)).toEqual(['First', 'Second']);
    expect(body.rows[0]?.props[TEXT]).toBe('one');
    expect(body.rows[1]?.props[SELECT]).toBe(OPTION);
  });

  it('refuses a page that carries no database', async () => {
    await seed(harness);
    const id = await makePage();

    const response = await readDatabase(id);
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('reports a page that is not there', async () => {
    await seed(harness);
    const response = await readDatabase('pg_00000000000000000000000000');
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /pages/:id/database', () => {
  it('takes the block off, and the rows go with it', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'Keep me' });

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${id}/database`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response, PageResponseSchema).page.database).toBeUndefined();

    const raw = await readFile(join(harness.contentDir, 'eng/tasks.md'), 'utf8');
    expect(raw).not.toContain('rows:');
    expect(raw).not.toContain('Keep me');
  });

  it('reports a page that is not there', async () => {
    await seed(harness);
    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/pages/pg_00000000000000000000000000/database',
      headers: headers(),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /pages/:id/database/rows', () => {
  it('creates a row inside the database page and answers 201', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());

    const response = await createRow(id, { title: 'Ship it', props: { [SELECT]: OPTION } });
    expect(response.statusCode).toBe(201);
    const row = bodyOf(response, RowResponseSchema).row;
    expect(row.id.startsWith('rw_')).toBe(true);
    expect(row.props[SELECT]).toBe(OPTION);

    const raw = await readFile(join(harness.contentDir, 'eng/tasks.md'), 'utf8');
    expect(raw).toContain('rows:');
    expect(raw).toContain('title: Ship it');
    // A row is a record, so it never becomes a page of its own.
    expect(existsSync(join(harness.contentDir, 'eng/tasks'))).toBe(false);
  });

  it('names an untitled row', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());

    const row = bodyOf(await createRow(id), RowResponseSchema).row;
    expect(row.title).toBe('Untitled');
    expect(row.props).toEqual({});
  });

  it('drops a cell the schema does not describe', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());

    const row = bodyOf(
      await createRow(id, {
        title: 'Row',
        props: { pr_00000000000000000000000000: 'ghost', [TEXT]: 'kept' },
      }),
      RowResponseSchema,
    ).row;
    expect(row.props).toEqual({ [TEXT]: 'kept' });
  });

  it('refuses a page that is not a database', async () => {
    await seed(harness);
    const id = await makePage();

    const response = await createRow(id, { title: 'Row' });
    expect(response.statusCode).toBe(400);
  });

  it('keeps the rows in the order they were added', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'One' });
    await createRow(id, { title: 'Two' });
    await createRow(id, { title: 'Three' });

    const body = bodyOf(await readDatabase(id), DatabaseResponseSchema);
    expect(body.rows.map((row) => row.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('commits the new row', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'Ship it' });
    await harness.git.flush();

    const log = await harness.git.history('eng/tasks.md', 10);
    expect(log.some((entry) => entry.message.includes('Add a row'))).toBe(true);
  });
});

describe('PATCH /pages/:id/database/rows/:rowId', () => {
  async function makeRow(): Promise<{ database: string; row: string }> {
    await seed(harness);
    const database = await makePage();
    await setDatabase(database, sampleDatabase());
    const row = bodyOf(
      await createRow(database, { title: 'Row', props: { [TEXT]: 'note' } }),
      RowResponseSchema,
    ).row;
    return { database, row: row.id };
  }

  async function patch(id: string, rowId: string, payload: Record<string, unknown>) {
    return harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}/database/rows/${rowId}`,
      headers: headers(),
      payload,
    });
  }

  it('changes one cell and leaves the others alone', async () => {
    const { database, row } = await makeRow();

    const response = await patch(database, row, { props: { [SELECT]: OPTION } });
    expect(response.statusCode).toBe(200);
    const saved = bodyOf(response, RowResponseSchema).row;
    expect(saved.props).toEqual({ [TEXT]: 'note', [SELECT]: OPTION });
  });

  it('clears a cell that is set to null', async () => {
    const { database, row } = await makeRow();

    const saved = bodyOf(
      await patch(database, row, { props: { [TEXT]: null } }),
      RowResponseSchema,
    ).row;
    expect(saved.props).toEqual({});
  });

  it('renames a row, and the page file keeps its own path', async () => {
    const { database, row } = await makeRow();

    const saved = bodyOf(
      await patch(database, row, { title: 'New name' }),
      RowResponseSchema,
    ).row;
    expect(saved.title).toBe('New name');

    const raw = await readFile(join(harness.contentDir, 'eng/tasks.md'), 'utf8');
    expect(raw).toContain('title: New name');
  });

  it('drops a select value no option matches', async () => {
    const { database, row } = await makeRow();

    const saved = bodyOf(
      await patch(database, row, { props: { [SELECT]: 'op_00000000000000000000000000' } }),
      RowResponseSchema,
    ).row;
    expect(saved.props[SELECT]).toBeUndefined();
  });

  it('refuses a property the database does not have', async () => {
    const { database, row } = await makeRow();

    const response = await patch(database, row, {
      props: { pr_00000000000000000000000000: 'ghost' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a page that carries no database', async () => {
    await seed(harness);
    const id = await makePage();
    const response = await patch(id, 'rw_00000000000000000000000000', { title: 'x' });
    expect(response.statusCode).toBe(400);
  });

  it('reports a row that is not there', async () => {
    const { database } = await makeRow();
    const response = await patch(database, 'rw_00000000000000000000000000', { title: 'x' });
    expect(response.statusCode).toBe(404);
  });

  it('reports a page that is not there', async () => {
    await seed(harness);
    const response = await patch('pg_00000000000000000000000000', 'rw_0000000000000000000000000A', {
      title: 'x',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /pages/:id/database/rows/:rowId', () => {
  async function remove(id: string, rowId: string) {
    return harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${id}/database/rows/${rowId}`,
      headers: headers(),
    });
  }

  it('takes the row out of the database', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    const keep = bodyOf(await createRow(id, { title: 'Keep' }), RowResponseSchema).row;
    const drop = bodyOf(await createRow(id, { title: 'Drop' }), RowResponseSchema).row;

    const response = await remove(id, drop.id);
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response, OkResponseSchema).ok).toBe(true);

    const body = bodyOf(await readDatabase(id), DatabaseResponseSchema);
    expect(body.rows.map((row) => row.id)).toEqual([keep.id]);
  });

  it('takes the whole block away with the last row', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    const only = bodyOf(await createRow(id, { title: 'Only' }), RowResponseSchema).row;

    await remove(id, only.id);

    const raw = await readFile(join(harness.contentDir, 'eng/tasks.md'), 'utf8');
    expect(raw).not.toContain('rows:');
    expect(raw).toContain('db:');
  });

  it('reports a row that is not there', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());

    const response = await remove(id, 'rw_00000000000000000000000000');
    expect(response.statusCode).toBe(404);
  });

  it('reports a page that is not there', async () => {
    await seed(harness);
    const response = await remove(
      'pg_00000000000000000000000000',
      'rw_00000000000000000000000000',
    );
    expect(response.statusCode).toBe(404);
  });

  it('commits the change', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    const row = bodyOf(await createRow(id, { title: 'Drop' }), RowResponseSchema).row;
    await remove(id, row.id);
    await harness.git.flush();

    const log = await harness.git.history('eng/tasks.md', 10);
    expect(log.some((entry) => entry.message.includes('Delete a row'))).toBe(true);
  });
});

describe('a database page under ordinary page edits', () => {
  it('keeps its schema when the body is rewritten', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}`,
      headers: headers(),
      payload: { markdown: 'New body.' },
    });

    const body = bodyOf(await readDatabase(id), DatabaseResponseSchema);
    expect(body.database.properties).toHaveLength(2);
  });

  it('keeps its rows when the body is rewritten', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'Row', props: { [TEXT]: 'note' } });

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}`,
      headers: headers(),
      payload: { markdown: 'Detail.' },
    });

    const body = bodyOf(await readDatabase(id), DatabaseResponseSchema);
    expect(body.rows[0]?.props[TEXT]).toBe('note');
  });

  it('keeps its rows when the page is renamed', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'Row', props: { [TEXT]: 'note' } });

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}`,
      headers: headers(),
      payload: { title: 'Work items' },
    });

    const body = bodyOf(await readDatabase(id), DatabaseResponseSchema);
    expect(body.rows.map((row) => row.title)).toEqual(['Row']);
  });

  it('drops the cells of a property the schema no longer has', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'Row', props: { [TEXT]: 'note', [SELECT]: OPTION } });

    const trimmed = sampleDatabase();
    trimmed.properties = trimmed.properties.filter((property) => property.id !== TEXT);
    await setDatabase(id, trimmed);

    const body = bodyOf(await readDatabase(id), DatabaseResponseSchema);
    expect(body.rows[0]?.props).toEqual({ [SELECT]: OPTION });
  });

  it('keeps no row page in the sidebar tree', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'Row' });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tree',
      headers: headers(),
    });
    expect(response.body).not.toContain('Row');
  });
});

describe('a board view over the wire', () => {
  function boardDatabase(): Database {
    const database = sampleDatabase();
    const view = database.views[0];
    if (view === undefined) throw new Error('the sample lost its view');
    view.name = 'Board';
    view.type = 'board';
    view.groupBy = SELECT;
    return database;
  }

  it('saves the layout and the column it stacks by', async () => {
    await seed(harness);
    const id = await makePage();

    const response = await setDatabase(id, boardDatabase());
    expect(response.statusCode).toBe(200);
    const view = bodyOf(response, PageResponseSchema).page.database?.views[0];
    expect(view?.type).toBe('board');
    expect(view?.groupBy).toBe(SELECT);
  });

  it('writes both into the page file', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, boardDatabase());

    const raw = await readFile(join(harness.contentDir, 'eng/tasks.md'), 'utf8');
    expect(raw).toContain('type: board');
    expect(raw).toContain(`groupBy: ${SELECT}`);
  });

  it('gives the view back on the next read', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, boardDatabase());

    const response = await readDatabase(id);
    const view = bodyOf(response, DatabaseResponseSchema).database.views[0];
    expect(view?.type).toBe('board');
    expect(view?.groupBy).toBe(SELECT);
  });

  it('refuses a layout nobody knows', async () => {
    await seed(harness);
    const id = await makePage();
    const database = sampleDatabase();

    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/pages/${id}/database`,
      headers: headers(),
      payload: { database: { ...database, views: [{ ...database.views[0], type: 'gallery' }] } },
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('refuses a group that is not a property id', async () => {
    await seed(harness);
    const id = await makePage();
    const database = sampleDatabase();

    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/pages/${id}/database`,
      headers: headers(),
      payload: { database: { ...database, views: [{ ...database.views[0], groupBy: 'Status' }] } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('creates a row that already holds the option of its stack', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, boardDatabase());

    const response = await createRow(id, { title: 'Ship it', props: { [SELECT]: OPTION } });
    expect(response.statusCode).toBe(201);
    expect(bodyOf(response, RowResponseSchema).row.props[SELECT]).toBe(OPTION);
  });
});
