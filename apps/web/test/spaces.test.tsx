import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Sidebar } from '../src/components/Sidebar/Sidebar';
import { AuthProvider } from '../src/lib/auth';
import type { SpaceTree } from '../src/lib/tree';
import { installFetch, type MockServer } from './mockFetch';
import { node } from './fixtures';
import { renderApp } from './render';

const RUNBOOKS = node('eng/runbooks', { title: 'Runbooks' });
const HOME = node('eng', { title: 'Engineering', children: [RUNBOOKS] });
const ENG: SpaceTree = { slug: 'eng', name: 'Engineering', tree: [HOME] };

let server: MockServer | null = null;

function startServer(): MockServer {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [ENG] },
    'POST /api/v1/spaces': { space: { slug: 'ops', name: 'Operations', icon: '🚀' } },
    'PATCH /api/v1/spaces/eng': { space: { slug: 'eng', name: 'Platform', icon: '🚀' } },
  });
  return server;
}

async function showSidebar(): Promise<void> {
  renderApp(
    <AuthProvider>
      <Sidebar onOpenPalette={vi.fn()} onCollapse={vi.fn()} />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByText('Engineering')).toBeTruthy());
}

function openSpaceMenu(): void {
  const row = screen.getByText('Engineering').closest('.tree-row');
  if (!row) throw new Error('No row for the space home page');
  fireEvent.contextMenu(row);
}

function typeIn(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => {
  server?.restore();
  server = null;
  localStorage.clear();
});

describe('create a space', () => {
  it('sends the name and the icon, then opens the new space', async () => {
    const mock = startServer();
    await showSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'New space' }));
    typeIn('Space name', 'Operations');
    typeIn('Search icons', 'rocket');
    fireEvent.click(await screen.findByRole('option', { name: 'rocket' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = mock.calls.find((call) => call.method === 'POST');
      expect(post?.url.pathname).toBe('/api/v1/spaces');
      expect(post?.body).toEqual({ slug: 'operations', name: 'Operations', icon: '🚀' });
    });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/p/ops'));
  });

  it('sends no icon when none is picked', async () => {
    const mock = startServer();
    await showSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'New space' }));
    typeIn('Space name', 'Operations');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = mock.calls.find((call) => call.method === 'POST');
      expect(post?.body).toEqual({ slug: 'operations', name: 'Operations' });
    });
  });
});

describe('edit a space', () => {
  it('patches the name and the icon from the home page menu', async () => {
    const mock = startServer();
    await showSidebar();

    openSpaceMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit space' }));
    expect(screen.getByLabelText('Space name')).toHaveValue('Engineering');

    typeIn('Space name', 'Platform');
    typeIn('Search icons', 'rocket');
    fireEvent.click(await screen.findByRole('option', { name: 'rocket' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = mock.calls.find((call) => call.method === 'PATCH');
      expect(patch?.url.pathname).toBe('/api/v1/spaces/eng');
      expect(patch?.body).toEqual({ name: 'Platform', icon: '🚀' });
    });
  });

  it('clears the icon when the person removes it', async () => {
    const mock = startServer();
    await showSidebar();

    openSpaceMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit space' }));
    typeIn('Search icons', 'rocket');
    fireEvent.click(await screen.findByRole('option', { name: 'rocket' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = mock.calls.find((call) => call.method === 'PATCH');
      expect(patch?.body).toEqual({ name: 'Engineering', icon: null });
    });
  });

  it('never offers the edit on a page below the space home', async () => {
    startServer();
    await showSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    const row = (await screen.findByText('Runbooks')).closest('.tree-row');
    if (!row) throw new Error('No row for Runbooks');
    fireEvent.contextMenu(row);

    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Edit space' })).toBeNull();
  });
});
