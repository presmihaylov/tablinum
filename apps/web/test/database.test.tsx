import { afterEach, describe, expect, it } from 'vitest';
import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  newOptionId,
  newPropertyId,
  newViewId,
  type Account,
  type Database,
  type DbRow,
  type DbView,
  type Page,
} from '@tablinum/shared';
import { DatabaseView } from '../src/components/Database/DatabaseView';
import { page } from './fixtures';
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

/** Deterministic, valid row ids: the shared guard rejects anything else. */
function rowId(seed: string): string {
  const base = seed.toUpperCase().replace(/[^0-9ABCDEFGHJKMNPQRSTVWXYZ]/g, '');
  return `rw_${(base + '0'.repeat(26)).slice(0, 26)}`;
}

function row(id: string, title: string, props: DbRow['props'] = {}): DbRow {
  return {
    id: rowId(id),
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
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({
          row: { ...ROWS[0]!, props: { ...ROWS[0]!.props, [NOTES]: 'changed' } },
        }),
      },
    });
    await screen.findByTestId('db-table');

    const input = within(await cellOf('Ship it', NOTES)).getByLabelText('Notes');
    await user.clear(input);
    await user.type(input, 'changed');
    await user.tab();

    await waitFor(() => expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ props: { [NOTES]: 'changed' } }));
  });

  it('clears a text cell that is emptied', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: { ...ROWS[0]!, props: {} } }),
      },
    });
    await screen.findByTestId('db-table');

    const input = within(await cellOf('Ship it', NOTES)).getByLabelText('Notes');
    await user.clear(input);
    await user.tab();

    await waitFor(() => expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ props: { [NOTES]: null } }));
  });

  it('sends a number cell as a number', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-table');

    const input = within(await cellOf('Ship it', SCORE)).getByLabelText('Score');
    await user.clear(input);
    await user.type(input, '11');
    await user.tab();

    await waitFor(() => expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ props: { [SCORE]: 11 } }));
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
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-table');

    await user.click(within(await cellOf('Ship it', STATUS)).getByLabelText('Status'));
    await user.click(await screen.findByRole('menuitem', { name: /Done/ }));

    await waitFor(() => expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ props: { [STATUS]: DONE } }));
  });

  it('adds an option to the schema before it puts one in a cell', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: ROWS[0]! }),
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
    await waitFor(() => expect(lastCall('PATCH', ROWS[0]!.id)).not.toBeNull());
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

  // The grid scrolls sideways, so a menu drawn inside it was cut off at the right edge.
  it('draws the column menu in a layer outside the grid', async () => {
    const user = userEvent.setup();
    mount();
    const table = await screen.findByTestId('db-table');

    await user.click(screen.getByRole('button', { name: /^Notes/ }));

    const menu = await screen.findByRole('menu', { name: 'Notes column' });
    expect(table.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
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
    await user.click(await screen.findByRole('menuitem', { name: 'Table' }));

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
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: { ...ROWS[0]!, title: 'Shipped' } }),
      },
    });
    await screen.findByTestId('db-table');

    const input = within((await rowOf('Ship it'))).getByLabelText(
      'Row title',
    );
    await user.clear(input);
    await user.type(input, 'Shipped');
    await user.tab();

    await waitFor(() => expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ title: 'Shipped' }));
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

    expect(lastCall('PATCH', ROWS[0]!.id)).toBeNull();
    expect((input as HTMLInputElement).value).toBe('Ship it');
  });

  it('deletes a row from its menu', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`DELETE /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ ok: true }),
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

  it('opens a row in the record panel', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(within(await rowOf('Ship it')).getByRole('button', { name: 'Open' }));

    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByLabelText<HTMLInputElement>('Row title').value).toBe('Ship it');
    expect(within(panel).getByLabelText<HTMLInputElement>('Notes').value).toBe('first');
  });

  it('saves a cell edited in the record panel', async () => {
    const user = userEvent.setup();
    mount({
      routes: {
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-table');

    await user.click(within(await rowOf('Ship it')).getByRole('button', { name: 'Open' }));
    const panel = await screen.findByRole('dialog');
    const input = within(panel).getByLabelText('Notes');
    await user.clear(input);
    await user.type(input, 'edited');
    await user.tab();

    await waitFor(() =>
      expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ props: { [NOTES]: 'edited' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------------

function boardDatabase(overrides: Partial<DbView> = {}): Database {
  const base = database();
  return {
    ...base,
    views: [{ ...base.views[0]!, name: 'Board', type: 'board', groupBy: STATUS, ...overrides }],
  };
}

/** A stack of the board, once the fetch behind it has landed. */
async function column(optionId: string | null): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector(`[data-group="${optionId ?? 'none'}"]`);
    if (found === null) throw new Error(`No stack for ${optionId ?? 'none'}`);
    return found as HTMLElement;
  });
}

/** The card of one record. */
async function card(title: string): Promise<HTMLElement> {
  const target = ROWS.find((entry) => entry.title === title);
  if (target === undefined) throw new Error(`No row titled ${title}`);
  return waitFor(() => {
    const found = document.querySelector(`article[data-row-id="${target.id}"]`);
    if (found === null) throw new Error(`No card rendered for ${title}`);
    return found as HTMLElement;
  });
}

/** Three cards in one stack, for the tests about the order inside a stack. */
const STACK: DbRow[] = [
  row('sa', 'Alpha', { [STATUS]: TODO }),
  row('sb', 'Bravo', { [STATUS]: TODO }),
  row('sc', 'Charlie', { [STATUS]: TODO }),
];

/** The card of any row, whether or not it belongs to the shared fixture. */
async function cardOf(id: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector(`article[data-row-id="${id}"]`);
    if (!(found instanceof HTMLElement)) throw new Error(`No card for ${id}`);
    return found;
  });
}

/** The strip a card sits in. It is the strip, not the card, that answers a drop. */
async function slot(id: string): Promise<HTMLElement> {
  const found = (await cardOf(id)).parentElement;
  if (!(found instanceof HTMLElement)) throw new Error(`No strip for ${id}`);
  return found;
}

/** A stand-in for the drag payload, which jsdom does not carry itself. */
function dragPayload(): DataTransfer {
  const store: Record<string, string> = {};
  const payload = {
    effectAllowed: 'move',
    dropEffect: 'move',
    get types(): string[] {
      return Object.keys(store);
    },
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? '',
  };
  return payload as unknown as DataTransfer;
}

describe('the board', () => {
  it('draws one stack per option and leaves the empty one last', async () => {
    mount({ db: boardDatabase() });

    const board = await screen.findByTestId('db-board');
    const names = [...board.querySelectorAll('.db-board__col')].map((col) =>
      col.getAttribute('aria-label'),
    );
    expect(names).toEqual(['Todo', 'Done', 'No Status']);
  });

  it('deals every card to the stack of its option', async () => {
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    expect(within(await column(TODO)).getByText('Ship it')).toBeTruthy();
    expect(within(await column(DONE)).getByText('Write it')).toBeTruthy();
    expect((await column(null)).textContent).toContain('0');
  });

  it('counts the cards of each stack', async () => {
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    expect(within(await column(TODO)).getByText('1')).toBeTruthy();
  });

  it('shows the other values on the card and never the one it stacks by', async () => {
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    const first = await card('Ship it');
    expect(first.textContent).toContain('first');
    expect(first.querySelector(`[data-property="${STATUS}"]`)).toBeNull();
  });

  it('leaves out a property the view hides', async () => {
    mount({ db: boardDatabase({ hidden: [NOTES] }) });
    await screen.findByTestId('db-board');

    expect((await card('Ship it')).textContent).not.toContain('first');
  });

  it('opens a card in the record panel', async () => {
    const user = userEvent.setup();
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    await user.click(within(await card('Ship it')).getByRole('button', { name: 'Ship it' }));

    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByLabelText<HTMLInputElement>('Row title').value).toBe('Ship it');
  });

  it('moves a card dropped on another stack', async () => {
    mount({
      db: boardDatabase(),
      routes: {
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-board');

    const payload = dragPayload();
    fireEvent.dragStart(await card('Ship it'), { dataTransfer: payload });
    fireEvent.dragOver(await column(DONE), { dataTransfer: payload });
    fireEvent.drop(await column(DONE), { dataTransfer: payload });

    // A drop on the stack itself, below its cards, means the end of it.
    await waitFor(() =>
      expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ props: { [STATUS]: DONE }, before: null }),
    );
  });

  it('clears the cell of a card dropped on the empty stack', async () => {
    mount({
      db: boardDatabase(),
      routes: {
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-board');

    const payload = dragPayload();
    fireEvent.dragStart(await card('Ship it'), { dataTransfer: payload });
    fireEvent.drop(await column(null), { dataTransfer: payload });

    await waitFor(() =>
      expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ props: { [STATUS]: null }, before: null }),
    );
  });

  it('says nothing to the server when a card lands on the stack it came from', async () => {
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    const payload = dragPayload();
    fireEvent.dragStart(await card('Ship it'), { dataTransfer: payload });
    fireEvent.drop(await column(TODO), { dataTransfer: payload });

    expect(lastCall('PATCH', ROWS[0]!.id)).toBeNull();
  });

  it('moves a card from its own menu', async () => {
    const user = userEvent.setup();
    mount({
      db: boardDatabase(),
      routes: {
        [`PATCH /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ row: ROWS[0]! }),
      },
    });
    await screen.findByTestId('db-board');

    await user.click(within(await card('Ship it')).getByLabelText('Card menu for Ship it'));
    await user.click(await screen.findByRole('menuitem', { name: 'Done' }));

    await waitFor(() => expect(lastCall('PATCH', ROWS[0]!.id)).toEqual({ props: { [STATUS]: DONE } }));
  });

  it('deletes a row from the card menu', async () => {
    const user = userEvent.setup();
    mount({
      db: boardDatabase(),
      routes: { [`DELETE /api/v1/pages/${PAGE.id}/database/rows/${ROWS[0]!.id}`]: () => ({ ok: true }) },
    });
    await screen.findByTestId('db-board');

    await user.click(within(await card('Ship it')).getByLabelText('Card menu for Ship it'));
    await user.click(await screen.findByRole('menuitem', { name: /Delete row/ }));

    await waitFor(() =>
      expect(
        (server?.calls ?? []).some(
          (call) => call.method === 'DELETE' && call.url.pathname.endsWith(ROWS[0]!.id),
        ),
      ).toBe(true),
    );
  });

  it('creates a row already holding the option of its stack', async () => {
    const user = userEvent.setup();
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    await user.click(screen.getByLabelText('New card in Done'));

    await waitFor(() =>
      expect(lastCall('POST', '/database/rows')).toEqual({ props: { [STATUS]: DONE } }),
    );
  });

  it('creates a plain row from the empty stack', async () => {
    const user = userEvent.setup();
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    await user.click(screen.getByLabelText('New card in No Status'));

    await waitFor(() => expect(lastCall('POST', '/database/rows')).toEqual({}));
  });

  it('asks for a select column when the database has none', async () => {
    const plain: Database = {
      properties: [{ id: NOTES, name: 'Notes', type: 'text', options: [] }],
      views: [{ id: VIEW, name: 'Board', type: 'board', filters: [], sorts: [], hidden: [] }],
    };
    mount({ db: plain, rows: [] });

    expect(
      await screen.findByText(/A board stacks its cards by a select column/),
    ).toBeTruthy();
  });

  it('keeps the filters of the view', async () => {
    mount({ db: boardDatabase({ filters: [{ property: STATUS, op: 'is', value: DONE }] }) });
    await screen.findByTestId('db-board');

    expect((await column(DONE)).textContent).toContain('Write it');
    expect((await column(TODO)).textContent).not.toContain('Ship it');
  });
});

// ---------------------------------------------------------------------------
// the order inside a stack
// ---------------------------------------------------------------------------

/** jsdom lays nothing out, so a card that a drop is measured against is given a box by hand. */
const CARD_HEIGHT = 100;
const UPPER = 10;
const LOWER = 90;

function boxed(node: HTMLElement): HTMLElement {
  node.getBoundingClientRect = () => new DOMRect(0, 0, 240, CARD_HEIGHT);
  return node;
}

/** A drag event carrying the height of the pointer, which fireEvent does not pass on its own. */
function drag(
  kind: 'dragOver' | 'drop',
  node: HTMLElement,
  dataTransfer: DataTransfer,
  clientY: number,
): void {
  const event = createEvent[kind](node, { dataTransfer });
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(node, event);
}

describe('the order of the cards in a stack', () => {
  function mountStack(view: Partial<DbView> = {}): void {
    mount({
      db: boardDatabase(view),
      rows: STACK,
      routes: Object.fromEntries(
        STACK.map((entry) => [
          `PATCH /api/v1/pages/${PAGE.id}/database/rows/${entry.id}`,
          () => ({ row: entry }),
        ]),
      ),
    });
  }

  it('puts a card dropped on the upper half of another in front of it', async () => {
    mountStack();
    await screen.findByTestId('db-board');

    const payload = dragPayload();
    const target = boxed(await slot(STACK[0]!.id));
    fireEvent.dragStart(await cardOf(STACK[2]!.id), { dataTransfer: payload });
    drag('dragOver', target, payload, UPPER);
    drag('drop', target, payload, UPPER);

    // Only the place changes: the card never left the stack it was in.
    await waitFor(() =>
      expect(lastCall('PATCH', STACK[2]!.id)).toEqual({ before: STACK[0]!.id }),
    );
  });

  it('puts a card dropped on the lower half of another behind it', async () => {
    mountStack();
    await screen.findByTestId('db-board');

    const payload = dragPayload();
    const target = boxed(await slot(STACK[0]!.id));
    fireEvent.dragStart(await cardOf(STACK[2]!.id), { dataTransfer: payload });
    drag('drop', target, payload, LOWER);

    await waitFor(() =>
      expect(lastCall('PATCH', STACK[2]!.id)).toEqual({ before: STACK[1]!.id }),
    );
  });

  it('draws a line where the card in the air would land', async () => {
    mountStack();
    await screen.findByTestId('db-board');

    const payload = dragPayload();
    const target = boxed(await slot(STACK[0]!.id));
    fireEvent.dragStart(await cardOf(STACK[2]!.id), { dataTransfer: payload });
    drag('dragOver', target, payload, UPPER);

    const lines = document.querySelectorAll('.db-board__line');
    expect(lines).toHaveLength(1);
    expect((await slot(STACK[0]!.id)).querySelector('.db-board__line')).not.toBeNull();
  });

  it('says nothing when a card is dropped back where it already was', async () => {
    mountStack();
    await screen.findByTestId('db-board');

    const payload = dragPayload();
    const target = boxed(await slot(STACK[1]!.id));
    fireEvent.dragStart(await cardOf(STACK[0]!.id), { dataTransfer: payload });
    drag('drop', target, payload, UPPER);

    expect(lastCall('PATCH', STACK[0]!.id)).toBeNull();
  });

  it('leaves the order alone when the view sorts the cards itself', async () => {
    mountStack({ sorts: [{ property: NOTES, direction: 'asc' }] });
    await screen.findByTestId('db-board');

    const payload = dragPayload();
    fireEvent.dragStart(await cardOf(STACK[0]!.id), { dataTransfer: payload });
    fireEvent.drop(await column(DONE), { dataTransfer: payload });

    await waitFor(() =>
      expect(lastCall('PATCH', STACK[0]!.id)).toEqual({ props: { [STATUS]: DONE } }),
    );
  });
});

// ---------------------------------------------------------------------------
// the stacks themselves
// ---------------------------------------------------------------------------

/** The options of the select column, as the last save left them. */
function savedOptions(): Array<{ id: string; name: string }> {
  const saved = lastCall('PUT', '/database') as { database: Database } | null;
  return saved?.database.properties.find((entry) => entry.id === STATUS)?.options ?? [];
}

describe('the stacks of a board', () => {
  it('adds a stack from the right end of the board', async () => {
    const user = userEvent.setup();
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    await user.click(screen.getByLabelText('Add a stack'));
    await user.type(await screen.findByLabelText('New stack name'), 'In review{Enter}');

    await waitFor(() => expect(savedOptions().map((one) => one.name)).toEqual([
      'Todo',
      'Done',
      'In review',
    ]));
  });

  it('renames a stack from its own head', async () => {
    const user = userEvent.setup();
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    await user.click(screen.getByLabelText('Stack menu for Todo'));
    const box = await screen.findByLabelText('Stack name');
    await user.clear(box);
    await user.type(box, 'Next up{Enter}');

    await waitFor(() => expect(savedOptions().map((one) => one.name)).toEqual(['Next up', 'Done']));
  });

  it('takes a stack off the board', async () => {
    const user = userEvent.setup();
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    await user.click(screen.getByLabelText('Stack menu for Todo'));
    await user.click(await screen.findByRole('menuitem', { name: /Delete stack/ }));

    await waitFor(() => expect(savedOptions().map((one) => one.name)).toEqual(['Done']));
  });

  it('has no menu on the stack that holds no option', async () => {
    mount({ db: boardDatabase() });
    await screen.findByTestId('db-board');

    expect(within(await column(null)).queryByRole('button', { name: /Stack menu/ })).toBeNull();
  });
});

describe('the view menu', () => {
  it('turns a table into a board and names the column it stacks by', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('tab', { name: 'Table' }));
    await user.selectOptions(await screen.findByLabelText('View layout'), 'board');

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views[0]?.type).toBe('board');
      expect(saved?.database.views[0]?.groupBy).toBe(STATUS);
    });
  });

  it('renames the open view', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('tab', { name: 'Table' }));
    const input = await screen.findByLabelText('View name');
    await user.clear(input);
    await user.type(input, 'Everything{Enter}');

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views[0]?.name).toBe('Everything');
    });
  });

  it('changes the column a board stacks by', async () => {
    const user = userEvent.setup();
    const second = newPropertyId();
    const wider: Database = {
      properties: [
        ...database().properties,
        { id: second, name: 'Stage', type: 'select', options: [] },
      ],
      views: boardDatabase().views,
    };
    mount({ db: wider });
    await screen.findByTestId('db-board');

    await user.click(screen.getByRole('tab', { name: 'Board' }));
    await user.selectOptions(await screen.findByLabelText('Group by'), second);

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views[0]?.groupBy).toBe(second);
    });
  });

  it('adds a board view that already knows what to stack by', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByLabelText('Add a view'));
    await user.click(await screen.findByRole('menuitem', { name: 'Board' }));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views[1]?.type).toBe('board');
      expect(saved?.database.views[1]?.name).toBe('Board 2');
      expect(saved?.database.views[1]?.groupBy).toBe(STATUS);
    });
  });

  it('deletes a view once a second one exists', async () => {
    const user = userEvent.setup();
    const base = database();
    const two: Database = {
      ...base,
      views: [base.views[0]!, { ...base.views[0]!, id: newViewId(), name: 'Board', type: 'board' }],
    };
    mount({ db: two });
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('tab', { name: 'Table' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete view' }));

    await waitFor(() => {
      const saved = lastCall('PUT', '/database') as { database: Database } | null;
      expect(saved?.database.views).toHaveLength(1);
      expect(saved?.database.views[0]?.name).toBe('Board');
    });
  });

  it('keeps the only view, which the database cannot be drawn without', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete view' })).toBeNull();
  });
});
