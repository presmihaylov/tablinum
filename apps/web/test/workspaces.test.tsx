import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { WORKSPACE_HEADER, type Account, type Workspace } from '@gitdocs/shared';
import { WorkspaceSwitcher } from '../src/components/Workspace/WorkspaceSwitcher';
import { setCurrentWorkspace } from '../src/lib/currentWorkspace';
import { installFetch, type MockServer, type Routes as MockRoutes } from './mockFetch';
import { renderApp } from './render';

const MAIN: Workspace = {
  id: 'ws_00000000000000000000000001',
  slug: 'main',
  name: 'Main',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
};

const HANDBOOK: Workspace = {
  ...MAIN,
  id: 'ws_00000000000000000000000002',
  slug: 'handbook',
  name: 'Handbook',
  icon: '📘',
};

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

const SAM: Account = {
  ...ADA,
  id: 'us_00000000000000000000000002',
  email: 'sam@example.com',
  name: 'Sam Rivers',
  handle: 'sam.rivers',
  role: 'member',
};

let server: MockServer | null = null;

function startServer(extra: MockRoutes = {}): MockServer {
  server = installFetch({
    'GET /api/v1/workspaces': { workspaces: [MAIN, HANDBOOK], current: 'main' },
    'GET /api/v1/tree': { spaces: [] },
    ...extra,
  });
  return server;
}

async function showSwitcher(): Promise<void> {
  renderApp(<WorkspaceSwitcher />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Workspace' }).textContent).toContain('Main'));
  fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
}

beforeEach(() => {
  setCurrentWorkspace(null);
});

afterEach(() => {
  server?.restore();
  server = null;
});

describe('the workspace switcher', () => {
  it('lists every workspace and names the open one', async () => {
    startServer();
    await showSwitcher();

    expect(await screen.findByRole('menuitem', { name: /Main/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Handbook/ })).toBeTruthy();
  });

  it('names the workspace on every request after a switch', async () => {
    const mock = startServer();
    await showSwitcher();

    fireEvent.click(await screen.findByRole('menuitem', { name: /Handbook/ }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    await waitFor(() => {
      expect(mock.calls.some((call) => call.headers[WORKSPACE_HEADER] === 'handbook')).toBe(true);
    });
  });

  it('creates a workspace and moves the tab into it', async () => {
    const mock = startServer({
      'POST /api/v1/workspaces': {
        workspace: { ...HANDBOOK, id: 'ws_00000000000000000000000003', slug: 'operations', name: 'Operations' },
      },
    });
    await showSwitcher();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'New workspace' }));
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Operations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = mock.calls.find((call) => call.method === 'POST');
      expect(post?.url.pathname).toBe('/api/v1/workspaces');
      expect(post?.body).toEqual({ name: 'Operations' });
    });
    await waitFor(() => {
      expect(mock.calls.some((call) => call.headers[WORKSPACE_HEADER] === 'operations')).toBe(true);
    });
  });

  it('imports a zip as a new workspace', async () => {
    const mock = startServer({
      'POST /api/v1/workspaces/import': {
        workspace: { ...HANDBOOK, id: 'ws_00000000000000000000000004', slug: 'field-notes', name: 'field notes' },
      },
    });
    renderApp(<WorkspaceSwitcher />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Workspace' })).toBeTruthy());

    const archive = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'field-notes.zip', {
      type: 'application/zip',
    });
    fireEvent.change(screen.getByLabelText('Workspace archive'), { target: { files: [archive] } });

    await waitFor(() => {
      const post = mock.calls.find((call) => call.url.pathname === '/api/v1/workspaces/import');
      expect(post?.method).toBe('POST');
      const body = post?.body;
      expect(body).toBeInstanceOf(FormData);
      const sent = body instanceof FormData ? body.get('file') : null;
      expect(sent instanceof File ? sent.name : null).toBe('field-notes.zip');
    });
    expect(await screen.findByText('Imported field notes')).toBeTruthy();
  });
});

describe('the workspace settings dialog', () => {
  async function openSettings(extra: MockRoutes = {}): Promise<MockServer> {
    const mock = startServer({
      'GET /api/v1/workspaces/ws_00000000000000000000000001/members': {
        members: [
          { account: ADA, role: 'admin' },
          { account: SAM, role: 'member' },
        ],
      },
      'GET /api/v1/users': { users: [ADA, SAM] },
      ...extra,
    });
    await showSwitcher();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Workspace settings' }));
    return mock;
  }

  it('shows who is in the workspace', async () => {
    await openSettings();

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Sam Rivers')).toBeTruthy();
    expect(screen.getByLabelText('Role of Sam Rivers')).toHaveValue('member');
  });

  it('makes somebody an admin of the workspace', async () => {
    const mock = await openSettings({
      'PATCH /api/v1/workspaces/ws_00000000000000000000000001/members/us_00000000000000000000000002': {
        members: [{ account: SAM, role: 'admin' }],
      },
    });

    fireEvent.change(await screen.findByLabelText('Role of Sam Rivers'), { target: { value: 'admin' } });

    await waitFor(() => {
      const patch = mock.calls.find((call) => call.method === 'PATCH');
      expect(patch?.url.pathname).toBe(
        '/api/v1/workspaces/ws_00000000000000000000000001/members/us_00000000000000000000000002',
      );
      expect(patch?.body).toEqual({ role: 'admin' });
    });
  });

  it('renames the workspace', async () => {
    const mock = await openSettings({
      'PATCH /api/v1/workspaces/ws_00000000000000000000000001': { workspace: { ...MAIN, name: 'Head office' } },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Head office' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = mock.calls.find((call) => call.method === 'PATCH');
      expect(patch?.url.pathname).toBe('/api/v1/workspaces/ws_00000000000000000000000001');
      expect(patch?.body).toEqual({ name: 'Head office', icon: null });
    });
  });

  it('links the export straight at the archive', async () => {
    await openSettings();

    const link = await screen.findByRole('link', { name: /Export as a zip/ });
    expect(link.getAttribute('href')).toBe('/api/v1/workspaces/ws_00000000000000000000000001/export');
    expect(link.getAttribute('download')).toBe('main.zip');
  });

  it('asks before it deletes the workspace', async () => {
    const mock = await openSettings({
      'DELETE /api/v1/workspaces/ws_00000000000000000000000001': { ok: true },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Delete workspace/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const sent = mock.calls.find((call) => call.method === 'DELETE');
      expect(sent?.url.pathname).toBe('/api/v1/workspaces/ws_00000000000000000000000001');
    });
  });
});
