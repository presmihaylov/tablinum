import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { Account, AccountRole } from '@tablinum/shared';
import { HomeRoute } from '../src/routes/HomeRoute';
import { AuthProvider } from '../src/lib/auth';
import type { SpaceTree } from '../src/lib/tree';
import { installFetch, type MockServer } from './mockFetch';
import { node } from './fixtures';
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

/** A space with no page in it, so the route stays on the welcome screen. */
const EMPTY: SpaceTree = { slug: 'eng', name: 'Engineering', tree: [] };

let server: MockServer | null = null;

function start(role: AccountRole, spaces: SpaceTree[]): MockServer {
  server = installFetch({
    'GET /api/v1/auth/state': { setupRequired: false, user: { ...ADA, role } },
    'GET /api/v1/tree': { spaces },
    'GET /api/v1/favorites': { favorites: [] },
  });
  return server;
}

async function showHome(): Promise<void> {
  renderApp(
    <AuthProvider>
      <HomeRoute />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Welcome to tablinum')).toBeTruthy());
}

afterEach(() => {
  server?.restore();
  server = null;
  localStorage.clear();
});

describe('the home route with no space to open', () => {
  it('asks an admin to create the first space', async () => {
    start('admin', []);
    await showHome();

    expect(screen.getByRole('button', { name: 'Create a space' })).toBeTruthy();
  });

  it('tells a member an admin has to make one, instead of a dead end', async () => {
    start('member', []);
    await showHome();

    expect(screen.getByText('No space is shared with you yet. An admin has to create one.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create a space' })).toBeNull();
  });

  it('leaves a member the private space they are allowed to make', async () => {
    start('member', []);
    await showHome();

    expect(screen.getByRole('button', { name: 'New private space' })).toBeTruthy();
  });

  it('offers the first page once a space exists, whoever is reading', async () => {
    start('member', [EMPTY]);
    await showHome();

    expect(screen.getByRole('button', { name: 'Create the first page' })).toBeTruthy();
  });
});
