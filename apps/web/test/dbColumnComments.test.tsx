import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  newPropertyId,
  newViewId,
  type Account,
  type Agent,
  type CommentThread,
  type Database,
  type DbRow,
  type Page,
} from '@tablinum/shared';
import { CommentsAside, CommentsPanel } from '../src/components/Comments/CommentsPanel';
import { DatabaseView } from '../src/components/Database/DatabaseView';
import { AuthProvider } from '../src/lib/auth';
import { CommentsProvider } from '../src/lib/comments';
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

const BOT: Agent = {
  id: 'ag_00000000000000000000000001',
  name: 'Doc Bot',
  handle: 'doc.bot',
  identity: 'Keeps the runbooks tidy.',
  workspaceId: 'ws_00000000000000000000000001',
  color: '#a855f7',
  avatarRev: null,
  webhookUrl: null,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  lastUsed: null,
};

const STATUS = newPropertyId();
const NOTES = newPropertyId();
/** A column the page no longer has: somebody edited the file by hand. */
const REMOVED = newPropertyId();
const VIEW = newViewId();

function database(): Database {
  return {
    properties: [
      { id: STATUS, name: 'Status', type: 'select', options: [] },
      { id: NOTES, name: 'Notes', type: 'text', options: [] },
    ],
    views: [{ id: VIEW, name: 'Table', type: 'table', filters: [], sorts: [], hidden: [] }],
  };
}

const NO_ROWS: DbRow[] = [];

const PAGE: Page = page({ path: 'eng/tasks', title: 'Tasks', database: database() });
/** Stands in for a page that embeds this database: the panel there belongs to the host. */
const HOST_PAGE = 'pg_00000000000000000000000009';

interface ThreadOptions {
  id: string;
  column?: string | null;
  body?: string;
  resolved?: boolean;
}

function thread({
  id,
  column = STATUS,
  body = 'Should this be a select?',
  resolved = false,
}: ThreadOptions): CommentThread {
  return {
    id,
    pageId: PAGE.id,
    anchor: null,
    column,
    resolved,
    resolvedBy: resolved ? ADA.id : null,
    resolvedAt: resolved ? '2026-01-02T00:00:00.000Z' : null,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    comments: [
      {
        id: id.replace('ct_', 'cm_'),
        threadId: id,
        author: ADA.id,
        body,
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

interface MountOptions {
  threads?: CommentThread[];
  db?: Database;
  /** The page the comment panel belongs to. Another id stands for an embedded database. */
  commentsPageId?: string;
  /** Draw the panel from the start, for a thread no column header can reach. */
  panelOpen?: boolean;
  routes?: Routes;
}

async function mount(options: MountOptions = {}): Promise<void> {
  const db = options.db ?? database();
  const threads = options.threads ?? [];
  server = installFetch({
    'GET /api/v1/tree': { spaces: [] },
    'GET /api/v1/auth/state': { setupRequired: false, user: ADA },
    'GET /api/v1/users': { users: [ADA] },
    'GET /api/v1/agents': { agents: [BOT] },
    [`GET /api/v1/pages/${PAGE.id}/database`]: () => ({ database: db, rows: NO_ROWS }),
    [`GET /api/v1/pages/${PAGE.id}/comments`]: () => ({ threads }),
    [`GET /api/v1/pages/${HOST_PAGE}/comments`]: () => ({ threads }),
    ...(options.routes ?? {}),
  });

  renderApp(
    <AuthProvider>
      <CommentsProvider pageId={options.commentsPageId ?? PAGE.id}>
        <DatabaseView page={PAGE} />
        {options.panelOpen === true ? <CommentsPanel /> : <CommentsAside />}
      </CommentsProvider>
    </AuthProvider>,
  );

  await screen.findByTestId('db-table');
}

function badge(name: string): Promise<HTMLElement> {
  return screen.findByRole('button', { name: new RegExp(`^Comments on ${name}, `) });
}

function panel(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Comments' });
}

/** Open the menu of one column header. */
async function openMenu(name: string): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
  return screen.findByRole('menu', { name: `${name} column` });
}

describe('the comment badge on a column header', () => {
  it('shows on a column with a thread, and counts only the open ones', async () => {
    await mount({
      threads: [
        thread({ id: 'ct_00000000000000000000000001' }),
        thread({ id: 'ct_00000000000000000000000002', resolved: true }),
        thread({ id: 'ct_00000000000000000000000003', column: NOTES }),
      ],
    });

    expect(await badge('Status')).toHaveAccessibleName('Comments on Status, 1 open');
    expect(await badge('Notes')).toHaveAccessibleName('Comments on Notes, 1 open');
  });

  it('stays away from a column nobody has commented on', async () => {
    await mount({ threads: [thread({ id: 'ct_00000000000000000000000001' })] });

    await badge('Status');
    expect(screen.queryByRole('button', { name: /^Comments on Notes/ })).toBeNull();
  });

  it('reads zero open once every thread on the column is resolved', async () => {
    await mount({
      threads: [thread({ id: 'ct_00000000000000000000000001', resolved: true })],
    });
    expect(await badge('Status')).toHaveAccessibleName('Comments on Status, 0 open');
  });

  it('opens the one comment surface with that thread in focus', async () => {
    const only = thread({ id: 'ct_00000000000000000000000001' });
    await mount({ threads: [only] });

    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();
    await userEvent.click(await badge('Status'));

    const aside = panel();
    expect(within(aside).getByText('Should this be a select?')).toBeTruthy();
    expect(within(aside).getByText(/Column: Status/)).toBeTruthy();
    expect(aside.querySelector(`[data-thread-id="${only.id}"]`)?.className).toContain(
      'comments__thread--active',
    );
  });

  it('follows a renamed column, because the thread names the property id', async () => {
    const renamed = database();
    const first = renamed.properties[0];
    if (first === undefined) throw new Error('The sample database has no property');
    renamed.properties[0] = { ...first, name: 'State' };

    await mount({
      db: renamed,
      threads: [thread({ id: 'ct_00000000000000000000000001' })],
      panelOpen: true,
    });

    expect(await badge('State')).toHaveAccessibleName('Comments on State, 1 open');
    await waitFor(() => expect(within(panel()).getByText(/Column: State/)).toBeTruthy());
  });

  it('says nothing about comments for a database embedded in another page', async () => {
    await mount({
      threads: [thread({ id: 'ct_00000000000000000000000001' })],
      commentsPageId: HOST_PAGE,
    });

    await screen.findByRole('button', { name: /^Status/ });
    expect(screen.queryByRole('button', { name: /^Comments on Status/ })).toBeNull();
  });
});

describe('writing a comment on a column', () => {
  it('posts the column id and no anchor', async () => {
    const written = thread({ id: 'ct_00000000000000000000000099' });
    await mount({
      routes: { [`POST /api/v1/pages/${PAGE.id}/comments`]: () => ({ thread: written }) },
    });

    const menu = await openMenu('Status');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Comment on this column' }));

    const aside = panel();
    expect(within(aside).getByText(/Column: Status/)).toBeTruthy();
    await userEvent.type(within(aside).getByLabelText('Write a comment'), 'Should this be a select?');
    await userEvent.click(within(aside).getByRole('button', { name: 'Comment' }));

    await waitFor(() => {
      const call = (server?.calls ?? []).find(
        (one) => one.method === 'POST' && one.url.pathname.endsWith('/comments'),
      );
      expect(call?.body).toEqual({ body: 'Should this be a select?', column: STATUS });
    });
  });

  it('offers nothing to write on a database embedded in another page', async () => {
    await mount({ commentsPageId: HOST_PAGE });

    const menu = await openMenu('Status');
    expect(within(menu).queryByRole('menuitem', { name: 'Comment on this column' })).toBeNull();
  });
});

describe('a thread whose column is no longer there', () => {
  it('reads as gone rather than as a remark about the whole page', async () => {
    await mount({
      threads: [thread({ id: 'ct_00000000000000000000000001', column: REMOVED })],
      panelOpen: true,
    });

    const aside = panel();
    await waitFor(() => expect(within(aside).getByText(/Column: gone/)).toBeTruthy());
    expect(within(aside).getByText('This column is no longer on the page.')).toBeTruthy();
    expect(within(aside).queryByText('On the whole page')).toBeNull();
  });
});

/**
 * Somebody deleted the whole `db` block in the markdown file. The page is a plain page again, so
 * no grid is drawn and the schema request is answered with an error: there are no columns at all.
 */
async function mountPlainPage(threads: CommentThread[]): Promise<void> {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [] },
    'GET /api/v1/auth/state': { setupRequired: false, user: ADA },
    'GET /api/v1/users': { users: [ADA] },
    'GET /api/v1/agents': { agents: [BOT] },
    [`GET /api/v1/pages/${PAGE.id}/comments`]: () => ({ threads }),
  });

  renderApp(
    <AuthProvider>
      <CommentsProvider pageId={PAGE.id}>
        <CommentsPanel />
      </CommentsProvider>
    </AuthProvider>,
  );

  await screen.findByRole('complementary', { name: 'Comments' });
}

const askedForSchema = (): boolean =>
  (server?.calls ?? []).some((call) => call.url.pathname.endsWith('/database'));

describe('a page whose database block was deleted by hand', () => {
  it('draws every column thread the way an orphaned quote is drawn', async () => {
    await mountPlainPage([thread({ id: 'ct_00000000000000000000000001' })]);

    const aside = panel();
    await waitFor(() => expect(within(aside).getByText(/Column: gone/)).toBeTruthy());
    // The whole card says so: struck through, and with the line that explains why.
    expect(aside.querySelector('.comments__column.is-gone')).toBeTruthy();
    expect(within(aside).getByText('This column is no longer on the page.')).toBeTruthy();
    expect(within(aside).queryByText('On the whole page')).toBeNull();
  });

  it('asks for the schema, because only the schema can say the column is gone', async () => {
    await mountPlainPage([thread({ id: 'ct_00000000000000000000000001' })]);
    await waitFor(() => expect(askedForSchema()).toBe(true));
  });

  it('asks for no schema when no thread is about a column', async () => {
    await mountPlainPage([thread({ id: 'ct_00000000000000000000000001', column: null })]);

    await screen.findByText('Should this be a select?');
    expect(askedForSchema()).toBe(false);
  });
});
