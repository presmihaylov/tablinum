import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Account } from '@tablinum/shared';
import { CommandPalette } from '../src/components/CommandPalette/CommandPalette';
import { Sidebar } from '../src/components/Sidebar/Sidebar';
import { AuthProvider } from '../src/lib/auth';
import type { SpaceTree } from '../src/lib/tree';
import { installFetch, type MockServer, type Routes as MockRoutes } from './mockFetch';
import { node, page } from './fixtures';
import { renderApp } from './render';

const DEPLOY = node('eng/deploy', { title: 'Deploy' });
const SECRET = node('notes/secret', { title: 'Secret' });
const ENG: SpaceTree = { slug: 'eng', name: 'Engineering', tree: [DEPLOY] };
const NOTES: SpaceTree = { slug: 'notes', name: 'Notes', tree: [SECRET], owner: 'us_ada' };

const ADA: Account = {
  id: 'us_ada',
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

let server: MockServer | null = null;

function start(routes: MockRoutes = {}): MockServer {
  server = installFetch({
    // An admin, because the Spaces bucket only offers a shared space to one.
    'GET /api/v1/auth/state': { setupRequired: false, user: ADA },
    'GET /api/v1/workspaces': { workspaces: [], current: null },
    'GET /api/v1/tree': { spaces: [ENG, NOTES] },
    'GET /api/v1/favorites': { favorites: [] },
    ...routes,
  });
  return server;
}

async function showSidebarAt(route: string): Promise<void> {
  renderApp(
    <AuthProvider>
      <Sidebar onOpenPalette={vi.fn()} onCollapse={vi.fn()} />
    </AuthProvider>,
    { route },
  );
  await waitFor(() => expect(screen.getByText('Deploy')).toBeTruthy());
}

async function showSidebar(): Promise<void> {
  await showSidebarAt('/');
}

function bucket(label: string): HTMLElement {
  return screen.getByRole('region', { name: label });
}

/** A DataTransfer double: the real one is not implemented in jsdom. */
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

function row(title: string): HTMLElement {
  const found = screen.getByText(title).closest('.tree-row');
  if (!found) throw new Error(`No row for ${title}`);
  return found as HTMLElement;
}

/** Drag one row onto another. jsdom gives every row a zero height, so the drop lands inside. */
function dragOnto(from: string, to: string): void {
  const payload = dragPayload();
  fireEvent.dragStart(row(from), { dataTransfer: payload });
  fireEvent.dragOver(row(to), { dataTransfer: payload });
  fireEvent.drop(row(to), { dataTransfer: payload });
}

function patchOf(mock: MockServer): { id: string; body: unknown } | null {
  const sent = mock.calls.find((call) => call.method === 'PATCH');
  if (!sent) return null;
  return { id: sent.url.pathname.split('/').pop() ?? '', body: sent.body };
}

afterEach(() => {
  server?.restore();
  server = null;
  localStorage.clear();
});

describe('the private bucket', () => {
  it('puts an owned space under Private and the rest under Spaces', async () => {
    start();
    await showSidebar();

    expect(within(bucket('Private')).getByText('Secret')).toBeInTheDocument();
    expect(within(bucket('Spaces')).getByText('Deploy')).toBeInTheDocument();
    expect(within(bucket('Spaces')).queryByText('Secret')).toBeNull();
    expect(within(bucket('Private')).queryByText('Deploy')).toBeNull();
  });

  it('says so when nothing is private', async () => {
    server = installFetch({
      'GET /api/v1/workspaces': { workspaces: [], current: null },
      'GET /api/v1/tree': { spaces: [ENG] },
      'GET /api/v1/favorites': { favorites: [] },
    });
    await showSidebar();

    expect(
      await within(bucket('Private')).findByText('Nothing private yet. Only you see what lands here.'),
    ).toBeInTheDocument();
  });

  it('folds the bucket away and back', async () => {
    start();
    await showSidebar();

    const toggle = within(bucket('Private')).getByRole('button', { name: 'Private' });
    fireEvent.click(toggle);
    await waitFor(() => expect(within(bucket('Private')).queryByText('Secret')).toBeNull());

    fireEvent.click(toggle);
    expect(await within(bucket('Private')).findByText('Secret')).toBeInTheDocument();
  });

  it('asks the server for a private space from the bucket action', async () => {
    const mock = start({
      'POST /api/v1/spaces': { space: { slug: 'vault', name: 'Vault', owner: 'us_ada' } },
    });
    await showSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'New private space' }));
    fireEvent.change(screen.getByLabelText('Space name'), { target: { value: 'Vault' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = mock.calls.find((call) => call.method === 'POST');
      expect(post?.url.pathname).toBe('/api/v1/spaces');
      expect(post?.body).toEqual({ slug: 'vault', name: 'Vault', private: true });
    });
  });

  it('remembers the private space of the page the reader opens', async () => {
    start();
    await showSidebarAt('/p/notes/secret');

    await waitFor(() => expect(localStorage.getItem('tablinum.space')).toBe('"notes"'));
  });

  it('sends New page back to the space the reader was last in', async () => {
    const mock = start({
      'POST /api/v1/pages': { page: page({ path: 'notes/bonus-letter', title: 'Bonus letter' }) },
    });
    // The reader was in the private space, then stepped off the page. The action used to fall
    // back to the first space in the tree, which is public, so private work landed in the open.
    localStorage.setItem('tablinum.space', '"notes"');
    renderApp(
      <AuthProvider>
        <CommandPalette open onClose={vi.fn()} />
      </AuthProvider>,
      { route: '/' },
    );

    // The hint carries the space the action targets, so it only reads "notes" once the tree is in.
    fireEvent.click(await screen.findByRole('option', { name: 'New page notes' }));
    const dialog = await screen.findByRole('dialog', { name: 'New page' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Bonus letter' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = mock.calls.find((call) => call.method === 'POST');
      expect(post?.body).toMatchObject({ path: 'notes/bonus-letter' });
    });
  });

  it('leaves the Spaces action public', async () => {
    const mock = start({ 'POST /api/v1/spaces': { space: { slug: 'ops', name: 'Operations' } } });
    await showSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'New space' }));
    fireEvent.change(screen.getByLabelText('Space name'), { target: { value: 'Operations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = mock.calls.find((call) => call.method === 'POST');
      expect(post?.body).toEqual({ slug: 'operations', name: 'Operations' });
    });
  });
});

describe('drag a page between the buckets', () => {
  it('marks the drop target even though it sits in another tree', async () => {
    start();
    await showSidebar();

    const payload = dragPayload();
    fireEvent.dragStart(row('Secret'), { dataTransfer: payload });
    fireEvent.dragOver(row('Deploy'), { dataTransfer: payload });

    // Each bucket draws its own tree. Without one shared drag state the row over there never
    // learns that a drag is in flight, and a browser then refuses the drop.
    await waitFor(() => expect(row('Deploy').className).toContain('tree-row--drop-inside'));
  });

  it('asks before it takes a page out of Private', async () => {
    const mock = start({
      [`PATCH /api/v1/pages/${SECRET.id}`]: {
        page: page({ id: SECRET.id, path: 'eng/deploy/secret', title: 'Secret' }),
      },
    });
    await showSidebar();

    dragOnto('Secret', 'Deploy');

    expect(await screen.findByText('Move out of Private?')).toBeInTheDocument();
    expect(patchOf(mock)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Move it' }));

    await waitFor(() =>
      expect(patchOf(mock)).toEqual({ id: SECRET.id, body: { order: 0, path: 'eng/deploy/secret' } }),
    );
  });

  it('sends nothing when the question is cancelled', async () => {
    const mock = start();
    await showSidebar();

    dragOnto('Secret', 'Deploy');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Move out of Private?')).toBeNull());
    expect(patchOf(mock)).toBeNull();
  });

  it('moves a page into Private with no question at all', async () => {
    const mock = start({
      [`PATCH /api/v1/pages/${DEPLOY.id}`]: {
        page: page({ id: DEPLOY.id, path: 'notes/secret/deploy', title: 'Deploy' }),
      },
    });
    await showSidebar();

    dragOnto('Deploy', 'Secret');

    await waitFor(() =>
      expect(patchOf(mock)).toEqual({ id: DEPLOY.id, body: { order: 0, path: 'notes/secret/deploy' } }),
    );
    expect(screen.queryByText('Move out of Private?')).toBeNull();
  });
});
