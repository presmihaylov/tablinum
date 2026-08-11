import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Account, Database, DbRow, Page } from '@tablinum/shared';
import { newOptionId, newPropertyId, newViewId } from '@tablinum/shared';
import { ARROW, wantsArrow } from '../src/lib/arrow';
import { AuthProvider } from '../src/lib/auth';
import { CommentsProvider } from '../src/lib/comments';
import { CommentsPanel } from '../src/components/Comments/CommentsPanel';
import { DatabaseView } from '../src/components/Database/DatabaseView';
import { page } from './fixtures';
import { installFetch, type MockServer } from './mockFetch';
import { renderApp } from './render';

/**
 * `->` in the surfaces that carry no ProseMirror. The rule for the page body lives with the
 * other typing rules, in test/editor/inputRules.test.ts.
 *
 * The listener under test is the one test/setup.ts puts on the document, exactly as main.tsx
 * does. No component asks for the rewrite, so no component can forget to.
 */

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

describe('when the rewrite is due', () => {
  it('is due for the "->" that sits right before the caret', () => {
    expect(wantsArrow('Ship it ->', 10)).toBe(true);
    expect(wantsArrow('a-> b', 3)).toBe(true);
  });

  it('is not due anywhere else', () => {
    expect(wantsArrow('a-> b', 5)).toBe(false);
    expect(wantsArrow('a- b', 4)).toBe(false);
    expect(wantsArrow('', 0)).toBe(false);
    expect(wantsArrow('a->', null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// every text box, through the one listener
// ---------------------------------------------------------------------------

function box(label: string): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByLabelText<HTMLInputElement>(label);
}

describe('any text box in the app', () => {
  it('rewrites "->" in an input nobody wired up', async () => {
    const user = userEvent.setup();
    render(<input aria-label="Anything" />);

    await user.type(box('Anything'), 'move it -> Tuesday');

    expect(box('Anything').value).toBe(`move it ${ARROW} Tuesday`);
  });

  it('rewrites "->" in a textarea nobody wired up', async () => {
    const user = userEvent.setup();
    render(<textarea aria-label="Anything" />);

    await user.type(box('Anything'), 'move it -> Tuesday');

    expect(box('Anything').value).toBe(`move it ${ARROW} Tuesday`);
  });

  it('puts the caret straight after the arrow', async () => {
    const user = userEvent.setup();
    render(<input aria-label="Anything" />);

    await user.type(box('Anything'), 'a->');

    expect(box('Anything').selectionStart).toBe(2);
  });

  it('leaves an address alone', async () => {
    const user = userEvent.setup();
    render(<input type="url" aria-label="Anything" />);

    await user.type(box('Anything'), 'https://example.com/a->b');

    expect(box('Anything').value).toBe('https://example.com/a->b');
  });

  it('leaves a number, a password and a search box alone', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input type="number" aria-label="Count" />
        <input type="password" aria-label="Secret" />
        <input type="search" aria-label="Find" />
      </>,
    );

    await user.type(box('Count'), '1');
    await user.type(box('Secret'), 'a->b');
    await user.type(box('Find'), 'a->b');

    expect(box('Secret').value).toBe('a->b');
    expect(box('Find').value).toBe('a->b');
  });

  it('leaves a field that asks to be left alone', async () => {
    const user = userEvent.setup();
    render(<input aria-label="Anything" data-no-arrow />);

    await user.type(box('Anything'), 'a->b');

    expect(box('Anything').value).toBe('a->b');
  });

  it('leaves every field inside a box that asks to be left alone', async () => {
    const user = userEvent.setup();
    render(
      <div data-no-arrow>
        <input aria-label="Anything" />
      </div>,
    );

    await user.type(box('Anything'), 'a->b');

    expect(box('Anything').value).toBe('a->b');
  });

  it('leaves the raw markdown of a conflict alone', async () => {
    const user = userEvent.setup();
    render(<textarea className="conflict__editor" aria-label="The merged page" />);

    await user.type(box('The merged page'), 'a -> b');

    expect(box('The merged page').value).toBe('a -> b');
  });

  it('leaves a field inside the page body to the ProseMirror rule', async () => {
    const user = userEvent.setup();
    render(
      <div contentEditable suppressContentEditableWarning>
        <input aria-label="Anything" />
      </div>,
    );

    await user.type(box('Anything'), 'a->b');

    expect(box('Anything').value).toBe('a->b');
  });

  it('leaves pasted text exactly as it arrived, the way the page body does', async () => {
    const user = userEvent.setup();
    render(<textarea aria-label="Anything" />);

    await user.click(box('Anything'));
    await user.paste('see -> the plan');

    expect(box('Anything').value).toBe('see -> the plan');
  });

  it('stands back while an IME composes, and looks once at the end', () => {
    render(<textarea aria-label="Anything" />);
    const field = box('Anything');

    fireEvent.compositionStart(field);
    field.value = 'a->';
    field.setSelectionRange(3, 3);
    fireEvent.input(field, { inputType: 'insertCompositionText', isComposing: true });
    expect(field.value).toBe('a->');

    fireEvent.compositionEnd(field);
    expect(field.value).toBe(`a${ARROW}`);
  });
});

// ---------------------------------------------------------------------------
// the comment box
// ---------------------------------------------------------------------------

const COMMENTED: Page = page({ markdown: 'Run the pipeline every Friday.\n' });

async function mountComments(): Promise<void> {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [] },
    'GET /api/v1/auth/state': { setupRequired: false, user: ADA },
    'GET /api/v1/users': { users: [ADA] },
    'GET /api/v1/agents': { agents: [] },
    [`GET /api/v1/pages/${COMMENTED.id}/comments`]: { threads: [] },
    [`POST /api/v1/pages/${COMMENTED.id}/comments`]: (_url, body) => ({
      thread: {
        id: 'ct_00000000000000000000000001',
        pageId: COMMENTED.id,
        anchor: null,
        resolved: false,
        resolvedBy: null,
        resolvedAt: null,
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
        comments: [
          {
            id: 'cm_00000000000000000000000001',
            threadId: 'ct_00000000000000000000000001',
            author: ADA.id,
            body: (body as { body: string }).body,
            created: '2026-01-01T00:00:00.000Z',
            updated: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }),
  });

  renderApp(
    <AuthProvider>
      <CommentsProvider pageId={COMMENTED.id}>
        <CommentsPanel />
      </CommentsProvider>
    </AuthProvider>,
  );

  await screen.findByRole('complementary', { name: 'Comments' });
}

function postedBodies(): string[] {
  return (server?.calls ?? [])
    .filter((call) => call.method === 'POST' && call.url.pathname.endsWith('/comments'))
    .map((call) => (call.body as { body: string }).body);
}

describe('the comment box', () => {
  it('turns "->" into an arrow while it is typed', async () => {
    const user = userEvent.setup();
    await mountComments();

    await user.click(screen.getByRole('button', { name: 'Comment on the page' }));
    const field = await screen.findByLabelText<HTMLTextAreaElement>('Write a comment');
    await user.type(field, 'move it -> Tuesday');

    expect(field.value).toBe(`move it ${ARROW} Tuesday`);
  });

  it('posts the arrow character, not the two typed ones', async () => {
    const user = userEvent.setup();
    await mountComments();

    await user.click(screen.getByRole('button', { name: 'Comment on the page' }));
    const field = await screen.findByLabelText('Write a comment');
    await user.type(field, 'move it -> Tuesday');
    await user.click(screen.getByRole('button', { name: /^Comment$/ }));

    await waitFor(() => expect(postedBodies()).toEqual([`move it ${ARROW} Tuesday`]));
  });
});

// ---------------------------------------------------------------------------
// database cells, and the filter box that has to match them
// ---------------------------------------------------------------------------

const NOTES = newPropertyId();
const LINK = newPropertyId();
const STATUS = newPropertyId();
const VIEW = newViewId();
const TODO = newOptionId();

const DB: Database = {
  properties: [
    { id: NOTES, name: 'Notes', type: 'text', options: [] },
    { id: LINK, name: 'Link', type: 'url', options: [] },
    { id: STATUS, name: 'Status', type: 'select', options: [{ id: TODO, name: 'Todo', color: 'gray' }] },
  ],
  views: [{ id: VIEW, name: 'Table', type: 'table', filters: [], sorts: [], hidden: [] }],
};

const ROW: DbRow = {
  id: 'rw_00000000000000000000000001',
  title: 'Ship it',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  props: {},
};

const GRID: Page = page({ path: 'eng/tasks', title: 'Tasks', database: DB });

function mountGrid(database: Database = DB): void {
  server = installFetch({
    [`GET /api/v1/pages/${GRID.id}/database`]: () => ({ database, rows: [ROW] }),
    'GET /api/v1/users': { users: [ADA] },
    [`PUT /api/v1/pages/${GRID.id}/database`]: () => ({ database, rows: [ROW] }),
    [`PATCH /api/v1/pages/${GRID.id}/database/rows/${ROW.id}`]: () => ({ row: ROW }),
  });
  renderApp(<DatabaseView page={GRID} />);
}

async function rowElement(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector(`tr[data-row-id="${ROW.id}"]`);
    if (found === null) throw new Error('the grid has no row yet');
    return found as HTMLElement;
  });
}

async function cellField(propertyId: string, label: string): Promise<HTMLInputElement> {
  const tr = await rowElement();
  const td = tr.querySelector(`td[data-property="${propertyId}"]`);
  if (td === null) throw new Error(`no cell for ${propertyId}`);
  return within(td as HTMLElement).getByLabelText<HTMLInputElement>(label);
}

describe('a database cell', () => {
  it('turns "->" into an arrow in a free text cell', async () => {
    const user = userEvent.setup();
    mountGrid();
    await screen.findByTestId('db-table');

    const field = await cellField(NOTES, 'Notes');
    await user.type(field, 'ours -> theirs');

    expect(field.value).toBe(`ours ${ARROW} theirs`);
  });

  it('sends the arrow character to the server', async () => {
    const user = userEvent.setup();
    mountGrid();
    await screen.findByTestId('db-table');

    const field = await cellField(NOTES, 'Notes');
    await user.type(field, 'ours -> theirs');
    await user.tab();

    await waitFor(() => {
      const patch = (server?.calls ?? []).filter((call) => call.method === 'PATCH').at(-1);
      expect(patch?.body).toEqual({ props: { [NOTES]: `ours ${ARROW} theirs` } });
    });
  });

  it('leaves a url cell alone, where an arrow would break the address', async () => {
    const user = userEvent.setup();
    mountGrid();
    await screen.findByTestId('db-table');

    const field = await cellField(LINK, 'Link');
    await user.type(field, 'https://example.com/a->b');

    expect(field.value).toBe('https://example.com/a->b');
  });

  it('turns "->" into an arrow in the row title', async () => {
    const user = userEvent.setup();
    mountGrid();
    await screen.findByTestId('db-table');

    const title = within(await rowElement()).getByLabelText<HTMLInputElement>('Row title');
    await user.clear(title);
    await user.type(title, 'ours -> theirs');

    expect(title.value).toBe(`ours ${ARROW} theirs`);
  });

  it('filters for the arrow a person just typed into a cell', async () => {
    const user = userEvent.setup();
    const filtered: Database = {
      ...DB,
      views: [{ ...DB.views[0]!, filters: [{ property: NOTES, op: 'contains', value: '' }] }],
    };
    mountGrid(filtered);
    await screen.findByTestId('db-table');

    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    const field = await screen.findByLabelText<HTMLInputElement>('Filter value');
    await user.type(field, 'ours -> theirs');

    expect(field.value).toBe(`ours ${ARROW} theirs`);
  });
});
