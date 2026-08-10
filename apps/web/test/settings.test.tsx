import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { Account, AuthStateResponse } from '@tablinum/shared';
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

function authState(user: Account): AuthStateResponse {
  return { setupRequired: false, user };
}

let server: MockServer | null = null;

function start(user: Account, routes: MockRoutes = {}): MockServer {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [] },
    'GET /api/v1/auth/state': authState(user),
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
    expect(screen.queryByRole('button', { name: 'People and invites' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agents' })).toBeNull();
  });

  it('lets an admin walk from one section to another', async () => {
    start(ADA);
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'People and invites' }));

    await screen.findByRole('heading', { name: 'People and invites' });
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/people');
    expect(await screen.findByText(`${ADA.name} (you)`)).toBeInTheDocument();
  });

  it('goes back to the pages', async () => {
    start(ADA);
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Back to the pages' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});
