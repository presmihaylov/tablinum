import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  newOptionId,
  newPropertyId,
  newViewId,
  type Account,
  type Database,
  type DbRow,
  type Page,
} from '@tablinum/shared';
import { DatabaseView } from '../src/components/Database/DatabaseView';
import { fakeId, page } from './fixtures';
import { installFetch, type MockServer, type Routes } from './mockFetch';
import { renderApp } from './render';

let server: MockServer | null = null;

afterEach(() => {
  server?.restore();
  server = null;
});

const ADA: Account = {
  id: 'us_00000000000000000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  handle: 'ada.lovelace',
  role: 'admin',
  color: '#3b82f6',
  avatarRev: null,
  disabled: false,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
};

const TODO = newOptionId();
const DONE = newOptionId();
const STATUS = newPropertyId();
const NOTES = newPropertyId();
const SCORE = newPropertyId();
const VIEW = newViewId();

function database(overrides: Partial<Database> = {}): Database {
  return {
    properties: [
      {
        id: STATUS,
        name: 'Status',
        type: 'select',
        options: [
          { id: TODO, name: 'Todo', color: 'gray' },
          { id: DONE, name: 'Done', color: 'green' },
        ],
      },
      { id: NOTES, name: 'Notes', type: 'text', options: [] },
      { id: SCORE, name: 'Score', type: 'number', options: [] },
    ],
    views: [{ id: VIEW, name: 'Table', type: 'table', filters: [], sorts: [], hidden: [] }],
    ...overrides,
  };
}

function row(id: string, title: string, props: DbRow['props'] = {}): DbRow {
  return {
    id: fakeId(id),
    path: `eng/tasks/${id}`,
    title,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    props,
  };
}

const ROWS: DbRow[] = [
  row('one', 'Ship it', { [STATUS]: TODO, [NOTES]: 'first', [SCORE]: 2 }),
  row('two', 'Write it', { [STATUS]: DONE, [NOTES]: 'second', [SCORE]: 9 }),
];

const PAGE: Page = page({ path: 'eng/tasks', title: 'Tasks', database: database() });

interface MountOptions {
  db?: Database;
  rows?: DbRow[];
  routes?: Routes;
}

function mount(options: MountOptions = {}): void {
  const db = options.db ?? database();
  const rows = options.rows ?? ROWS;
  server = installFetch({
    [`GET /api/v1/pages/${PAGE.id}/database`]: () => ({ database: db, rows }),
    'GET /api/v1/users': { users: [ADA] },
    [`PUT /api/v1/pages/${PAGE.id}/database`]: (_url, body) => ({
      page: { ...PAGE, database: (body as { database: Database }).database },
    }),
    [`POST /api/v1/pages/${PAGE.id}/database/rows`]: () => ({ row: row('new', 'Untitled') }),
    ...(options.routes ?? {}),
  });
  renderApp(<DatabaseView page={{ ...PAGE, database: db }} />);
}

/** The row of the grid a record is drawn in, once the fetch behind it has landed. */
async function rowOf(title: string): Promise<HTMLElement> {
  const target = ROWS.find((entry) => entry.title === title);
  if (target === undefined) throw new Error(`No row titled ${title}`);
  return waitFor(() => {
    const tr = document.querySelector(`tr[data-row-id="${target.id}"]`);
    if (tr === null) throw new Error(`No row rendered for ${title}`);
    return tr as HTMLElement;
  });
}

/** The body cell of one row under one property. */
async function cellOf(title: string, propertyId: string): Promise<HTMLElement> {
  const tr = await rowOf(title);
  const td = tr.querySelector(`td[data-property="${propertyId}"]`);
  if (td === null) throw new Error(`No cell for ${propertyId}`);
  return td as HTMLElement;
}

function rowTitles(): string[] {
  return [...document.querySelectorAll('tbody tr')].map((tr) => {
    const input = tr.querySelector('input[aria-label="Row title"]');
    return input instanceof HTMLInputElement ? input.value : '';
  });
}

/** The body of the last request that matched a method and a path suffix. */
function lastCall(method: string, suffix: string): unknown {
  const calls = (server?.calls ?? []).filter(
    (call) => call.method === method && call.url.pathname.endsWith(suffix),
  );
  return calls[calls.length - 1]?.body ?? null;
}

describe('the grid', () => {
  it('renders one column per property and one row per record', async () => {
    mount();

    const table = await screen.findByTestId('db-table');
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((head) => head.textContent)).toEqual([
      'Name',
      'StatusSelect',
      'NotesText',
      'ScoreNumber',
      '',
    ]);
    await waitFor(() => expect(rowTitles()).toEqual(['Ship it', 'Write it']));
  });

  it('shows the option a select cell holds', async () => {
    mount();
    await screen.findByTestId('db-table');

    expect((await cellOf('Ship it', STATUS)).textContent).toBe('Todo');
    expect((await cellOf('Write it', STATUS)).textContent).toBe('Done');
  });

  it('hides a property the view hides', async () => {
    mount({ db: { ...database(), views: [{ ...database().views[0]!, hidden: [NOTES] }] } });

    const table = await screen.findByTestId('db-table');
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((head) => head.textContent)).not.toContain('Notes');
  });

  it('says so when a database has no rows', async () => {
    mount({ rows: [] });
    expect(await screen.findByText('This database has no rows yet.')).toBeTruthy();
  });
});

describe('editing a cell', () => {
  it('saves a text cell when it loses focus', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${ROWS[0]!.id}/row`]: () => ({
          row: { ...ROWS[0]!, props: { ...ROWS[0]!.props, [NOTES]: 'changed' } },
        }),
      },
    });
    await screen.findByTestId('db-table');

    const input = within(await cellOf('Ship it', NOTES)).getByLabelText('Notes');
    await user.clear(input);
    await user.type(input, 'changed');
    await user.tab();

    await waitFor(() => expect(lastCall('PATCH', '/row')).toEqual({ props: { [NOTES]: 'changed' } }));
  });

  it('clears a text cell that is emptied', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${ROWS[0]!.id}/row`]: () => ({ row: { ...ROWS[0]!, props: {} } }),
      },
    });
    await screen.findByTestId('db-table');

    const input = within(await cellOf('Ship it', NOTES)).getByLabelText('Notes');
    await user.clear(input);
    await user.tab();

    await waitFor(() => expect(lastCall('PATCH', '/row')).toEqual({ props: { [NOTES]: null } }));
  });

  it('sends a number cell as a number', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${ROWS[0]!.id}/row`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-table');

    const input = within(await cellOf('Ship it', SCORE)).getByLabelText('Score');
    await user.clear(input);
    await user.type(input, '11');
    await user.tab();

    await waitFor(() => expect(lastCall('PATCH', '/row')).toEqual({ props: { [SCORE]: 11 } }));
  });

  it('keeps what is typed when the server copy arrives late', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    const input = within(await cellOf('Ship it', NOTES)).getByLabelText('Notes');
    await user.clear(input);
    await user.type(input, 'half typed');
    expect((input as HTMLInputElement).value).toBe('half typed');
  });

  it('picks an option from the menu of a select cell', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${ROWS[0]!.id}/row`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-table');

    await user.click(within(await cellOf('Ship it', STATUS)).getByLabelText('Status'));
    await user.click(await screen.findByRole('menuitem', { name: /Done/ }));

    await waitFor(() => expect(lastCall('PATCH', '/row')).toEqual({ props: { [STATUS]: DONE } }));
  });

  it('adds an option to the schema before it puts one in a cell', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${ROWS[0]!.id}/row`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-table');

    await user.click(within(await cellOf('Ship it', STATUS)).getByLabelText('Status'));
    await user.type(await screen.findByLabelText('Search Status options'), 'Blocked');
    await user.click(await screen.findByRole('menuitem', { name: /Create/ }));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      const status = saved?.database.properties.find((property) => property.id === STATUS);
      expect(status?.options.map((option) => option.name)).toEqual(['Todo', 'Done', 'Blocked']);
    });
    await waitFor(() => expect(lastCall('PATCH', '/row')).not.toBeNull());
  });
});

describe('the schema', () => {
  it('adds a property', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByLabelText('Add a property'));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.properties).toHaveLength(4);
      expect(saved?.database.properties[3]?.name).toBe('Property');
      expect(saved?.database.properties[3]?.type).toBe('text');
    });
  });

  it('renames a property from its header menu', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('button', { name: /^Notes/ }));
    const name = await screen.findByLabelText('Property name');
    await user.clear(name);
    await user.type(name, 'Detail');
    await user.tab();

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.properties[1]?.name).toBe('Detail');
    });
  });

  it('changes the type of a property', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('button', { name: /^Notes/ }));
    await user.selectOptions(await screen.findByLabelText('Property type'), 'checkbox');

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.properties[1]?.type).toBe('checkbox');
    });
  });

  it('deletes a property and every filter that named it', async () => {
    const user = userEvent.setup();
    const withFilter: Database = {
      ...database(),
      views: [{ ...database().views[0]!, filters: [{ property: NOTES, op: 'contains', value: 'x' }] }],
    };
    mount({ db: withFilter });
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('button', { name: /^Notes/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Delete property/ }));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.properties.map((property) => property.id)).toEqual([STATUS, SCORE]);
      expect(saved?.database.views[0]?.filters).toEqual([]);
    });
  });

  it('hides a property from the current view', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('button', { name: /^Notes/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Hide in this view/ }));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views[0]?.hidden).toEqual([NOTES]);
    });
  });
});

describe('views', () => {
  it('filters the rows the grid shows', async () => {
    const filtered: Database = {
      ...database(),
      views: [{ ...database().views[0]!, filters: [{ property: STATUS, op: 'is', value: DONE }] }],
    };
    mount({ db: filtered });

    await screen.findByTestId('db-table');
    await waitFor(() => expect(rowTitles()).toEqual(['Write it']));
  });

  it('sorts the rows the grid shows', async () => {
    const sorted: Database = {
      ...database(),
      views: [{ ...database().views[0]!, sorts: [{ property: SCORE, direction: 'desc' }] }],
    };
    mount({ db: sorted });

    await screen.findByTestId('db-table');
    await waitFor(() => expect(rowTitles()).toEqual(['Write it', 'Ship it']));
  });

  it('adds a filter from the filter panel', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    await user.click(await screen.findByRole('button', { name: /Add a filter/ }));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views[0]?.filters).toHaveLength(1);
      expect(saved?.database.views[0]?.filters[0]?.property).toBe(STATUS);
    });
  });

  it('adds a sort from the sort panel', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('button', { name: /^Sort/ }));
    await user.click(await screen.findByRole('button', { name: /Add a sort/ }));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views[0]?.sorts).toEqual([{ property: STATUS, direction: 'asc' }]);
    });
  });

  it('adds a view', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByLabelText('Add a view'));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views).toHaveLength(2);
      expect(saved?.database.views[1]?.name).toBe('Table 2');
    });
  });
});

describe('rows', () => {
  it('creates a row from the New button', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getAllByRole('button', { name: 'New' })[0] as HTMLElement);

    await waitFor(() => expect(lastCall('POST', '/database/rows')).toEqual({}));
  });

  it('renames a row', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${ROWS[0]!.id}/row`]: () => ({ row: { ...ROWS[0]!, title: 'Shipped' } }),
      },
    });
    await screen.findByTestId('db-table');

    const input = within((await rowOf('Ship it'))).getByLabelText(
      'Row title',
    );
    await user.clear(input);
    await user.type(input, 'Shipped');
    await user.tab();

    await waitFor(() => expect(lastCall('PATCH', '/row')).toEqual({ title: 'Shipped' }));
  });

  it('refuses to blank a row title', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    const input = within((await rowOf('Ship it'))).getByLabelText(
      'Row title',
    );
    await user.clear(input);
    await user.tab();

    expect(lastCall('PATCH', '/row')).toBeNull();
    expect((input as HTMLInputElement).value).toBe('Ship it');
  });

  it('deletes a row from its menu', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`DELETE /api/v1/pages/${ROWS[0]!.id}`]: () => ({ deleted: [ROWS[0]!.path] }),
      },
    });
    await screen.findByTestId('db-table');

    await rowOf('Ship it');
    await user.click(screen.getByLabelText('Row menu for Ship it'));
    await user.click(await screen.findByRole('menuitem', { name: /Delete row/ }));

    await waitFor(() => {
      const deleted = (server?.calls ?? []).filter((call) => call.method === 'DELETE');
      expect(deleted).toHaveLength(1);
    });
  });

  it('links to the page a row lives on', async () => {
    mount();
    await screen.findByTestId('db-table');

    const link = within((await rowOf('Ship it'))).getByRole('link', {
      name: 'Open',
    });
    expect(link.getAttribute('href')).toContain('eng/tasks/one');
  });
});
