import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DatabaseResponseSchema,
  ErrorBodySchema,
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
  it('takes the block off and leaves the rows in place', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    const row = bodyOf(await createRow(id, { title: 'Keep me' }), RowResponseSchema).row;

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${id}/database`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response, PageResponseSchema).page.database).toBeUndefined();

    const kept = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${row.id}`,
      headers: headers(),
    });
    expect(bodyOf(kept, PageResponseSchema).page.title).toBe('Keep me');
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
  it('creates a row as a child page and answers 201', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());

    const response = await createRow(id, { title: 'Ship it', props: { [SELECT]: OPTION } });
    expect(response.statusCode).toBe(201);
    const row = bodyOf(response, RowResponseSchema).row;
    expect(row.path).toBe('eng/tasks/ship-it');
    expect(row.props[SELECT]).toBe(OPTION);
    expect(existsSync(join(harness.contentDir, 'eng/tasks/ship-it.md'))).toBe(true);
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

  it('commits the new row', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    await createRow(id, { title: 'Ship it' });
    await harness.git.flush();

    const log = await harness.git.history('eng/tasks/ship-it.md', 10);
    expect(log.some((entry) => entry.message.includes('eng/tasks/ship-it'))).toBe(true);
  });
});

describe('PATCH /pages/:id/row', () => {
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

  async function patch(id: string, payload: Record<string, unknown>) {
    return harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}/row`,
      headers: headers(),
      payload,
    });
  }

  it('changes one cell and leaves the others alone', async () => {
    const { row } = await makeRow();

    const response = await patch(row, { props: { [SELECT]: OPTION } });
    expect(response.statusCode).toBe(200);
    const saved = bodyOf(response, RowResponseSchema).row;
    expect(saved.props).toEqual({ [TEXT]: 'note', [SELECT]: OPTION });
  });

  it('clears a cell that is set to null', async () => {
    const { row } = await makeRow();

    const saved = bodyOf(await patch(row, { props: { [TEXT]: null } }), RowResponseSchema).row;
    expect(saved.props).toEqual({});
  });

  it('renames a row without moving its file', async () => {
    const { row } = await makeRow();

    const saved = bodyOf(await patch(row, { title: 'New name' }), RowResponseSchema).row;
    expect(saved.title).toBe('New name');
    expect(saved.path).toBe('eng/tasks/row');
  });

  it('drops a select value no option matches', async () => {
    const { row } = await makeRow();

    const saved = bodyOf(
      await patch(row, { props: { [SELECT]: 'op_00000000000000000000000000' } }),
      RowResponseSchema,
    ).row;
    expect(saved.props[SELECT]).toBeUndefined();
  });

  it('refuses a property the database does not have', async () => {
    const { row } = await makeRow();

    const response = await patch(row, { props: { pr_00000000000000000000000000: 'ghost' } });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a page whose parent is not a database', async () => {
    const { pageIds } = await seed(harness);
    const response = await patch(pageIds[0] as string, { title: 'x' });
    expect(response.statusCode).toBe(400);
  });

  it('reports a page that is not there', async () => {
    await seed(harness);
    const response = await patch('pg_00000000000000000000000000', { title: 'x' });
    expect(response.statusCode).toBe(404);
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

  it('keeps the cells of a row when the body of that row is rewritten', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    const row = bodyOf(
      await createRow(id, { title: 'Row', props: { [TEXT]: 'note' } }),
      RowResponseSchema,
    ).row;

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${row.id}`,
      headers: headers(),
      payload: { markdown: 'Detail.' },
    });

    const body = bodyOf(await readDatabase(id), DatabaseResponseSchema);
    expect(body.rows[0]?.props[TEXT]).toBe('note');
  });

  it('drops a row from the grid when the row page is deleted', async () => {
    await seed(harness);
    const id = await makePage();
    await setDatabase(id, sampleDatabase());
    const row = bodyOf(await createRow(id, { title: 'Row' }), RowResponseSchema).row;

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${row.id}`,
      headers: headers(),
    });

    const body = bodyOf(await readDatabase(id), DatabaseResponseSchema);
    expect(body.rows).toEqual([]);
  });
});
