import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { Account, AuthStateResponse, Workspace } from '@tablinum/shared';
import { AuthProvider } from '../src/lib/auth';
import { SettingsRoute } from '../src/routes/SettingsRoute';
import { installFetch, type MockServer, type Routes as MockRoutes } from './mockFetch';
import { renderApp } from './render';

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

const SAM: Account = { ...ADA, id: 'us_00000000000000000000000002', name: 'Sam Rivers', role: 'member' };

const MAIN: Workspace = {
  id: 'ws_00000000000000000000000001',
  slug: 'main',
  name: 'Main',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
};

function authState(user: Account): AuthStateResponse {
  return { setupRequired: false, user };
}

let server: MockServer | null = null;

function start(user: Account, routes: MockRoutes = {}): MockServer {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [] },
    'GET /api/v1/auth/state': authState(user),
    'GET /api/v1/workspaces': { workspaces: [MAIN], current: 'main' },
    'GET /api/v1/workspaces/ws_00000000000000000000000001/members': {
      members: [{ account: ADA, role: 'admin' }],
    },
    'GET /api/v1/users': { users: [ADA, SAM] },
    'GET /api/v1/invites': { invites: [] },
    'GET /api/v1/emoji': { emoji: [] },
    'GET /api/v1/agents': { agents: [] },
    ...routes,
  });
  return server;
}

/** The page reads its section from the path, so it needs a real route around it. */
function renderSettings(route = '/settings'): void {
  renderApp(
    <AuthProvider>
      <Routes>
        <Route path="/settings" element={<SettingsRoute />} />
        <Route path="/settings/:section" element={<SettingsRoute />} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('the settings page', () => {
  it('opens on your own account when no section is named', async () => {
    start(ADA);
    renderSettings();

    await screen.findByRole('heading', { name: 'My account' });
    expect(screen.getByLabelText('Display name')).toHaveValue(ADA.name);
  });

  it('opens the section the path names', async () => {
    start(ADA);
    renderSettings('/settings/emoji');

    await screen.findByRole('heading', { name: 'Custom emoji' });
    expect(screen.getByLabelText('Emoji name')).toBeInTheDocument();
  });

  it('hides the admin sections from a member, and falls back to the account', async () => {
    start(SAM);
    renderSettings('/settings/agents');

    // The path named a section this account cannot see, so the first one it can see wins.
    await screen.findByRole('heading', { name: 'My account' });
    expect(screen.queryByRole('button', { name: 'Agents' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Workspace' })).toBeInTheDocument();
  });

  it('lets an admin walk from one section to another', async () => {
    start(ADA);
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Workspace' }));

    await screen.findByRole('heading', { name: 'Workspace' });
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/workspace');
    expect(await screen.findByText(`${ADA.name} (you)`)).toBeInTheDocument();
  });

  // People and invites used to be a section of its own. A link somebody kept must still work.
  it('sends the old people path to the workspace section', async () => {
    start(ADA);
    renderSettings('/settings/people');

    await screen.findByRole('heading', { name: 'Workspace' });
    expect(await screen.findByRole('region', { name: 'Accounts' })).toBeInTheDocument();
  });

  it('goes back to the pages', async () => {
    start(ADA);
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Back to the pages' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});

const MEMBERS = 'GET /api/v1/workspaces/ws_00000000000000000000000001/members';
const RESCAN = '/api/v1/rescan';

function rescanCalls(mock: MockServer): number {
  return mock.calls.filter((call) => call.url.pathname === RESCAN).length;
}

/** The sweep deletes attachment files, so the control is admin-only and asks before it runs. */
describe('the rescan control', () => {
  it('stays hidden from somebody who is not an admin of the workspace', async () => {
    start(SAM, {
      [MEMBERS]: {
        members: [
          { account: ADA, role: 'admin' },
          { account: SAM, role: 'member' },
        ],
      },
    });
    renderSettings('/settings/workspace');

    await screen.findByRole('region', { name: 'People in this workspace' });
    expect(screen.queryByRole('region', { name: 'Rescan the content directory' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rescan' })).toBeNull();
  });

  it('shows for an install admin', async () => {
    start(ADA);
    renderSettings('/settings/workspace');

    expect(await screen.findByRole('button', { name: 'Rescan' })).toBeEnabled();
  });

  // requireWorkspaceAdmin() takes an admin of this one workspace as well as an install admin,
  // so the coarser install check would hide the button from somebody the route lets through.
  it('shows for an admin of this workspace who is not an install admin', async () => {
    start(SAM, { [MEMBERS]: { members: [{ account: SAM, role: 'admin' }] } });
    renderSettings('/settings/workspace');

    expect(await screen.findByRole('button', { name: 'Rescan' })).toBeEnabled();
  });

  it('asks first, then names every file it took away', async () => {
    const mock = start(ADA, {
      'POST /api/v1/rescan': {
        pages: 12,
        removedAssets: ['_assets/pg_00000000000000000000000009/old.png'],
      },
    });
    const user = userEvent.setup();
    renderSettings('/settings/workspace');

    await user.click(await screen.findByRole('button', { name: 'Rescan' }));

    const dialog = screen.getByRole('dialog', { name: 'Rescan Main?' });
    expect(dialog).toHaveTextContent(/deletes the attachment files of pages that are gone/);
    expect(dialog).toHaveTextContent(/no history to restore from/);
    // The whole point of the dialog: nothing has run yet.
    expect(rescanCalls(mock)).toBe(0);

    await user.click(within(dialog).getByRole('button', { name: 'Rescan' }));

    expect(await screen.findByText('The search index now holds 12 pages.')).toBeInTheDocument();
    expect(
      screen.getByText('1 attachment file left the content directory for good:'),
    ).toBeInTheDocument();
    expect(screen.getByText('_assets/pg_00000000000000000000000009/old.png')).toBeInTheDocument();
    expect(rescanCalls(mock)).toBe(1);
  });

  it('goes dead while the rescan is in flight', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = start(ADA, {
      'POST /api/v1/rescan': async () => {
        await held;
        return { pages: 3, removedAssets: [] };
      },
    });
    const user = userEvent.setup();
    renderSettings('/settings/workspace');

    await user.click(await screen.findByRole('button', { name: 'Rescan' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rescan' }));

    const button = await screen.findByRole('button', { name: 'Rescanning…' });
    await waitFor(() => expect(button).toBeDisabled());
    // A second rescan while the first one reads every page would be a wasted CPU spike.
    await user.click(button);
    expect(rescanCalls(mock)).toBe(1);

    release();
    expect(await screen.findByText('No attachment was removed.')).toBeInTheDocument();
  });
});
