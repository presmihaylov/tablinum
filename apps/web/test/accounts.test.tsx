import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { Account, AuthStateResponse, Invite, Workspace } from '@tablinum/shared';
import { App } from '../src/App';
import { AccountMenu } from '../src/components/Account/AccountMenu';
import { Avatar } from '../src/components/Account/Avatar';
import { PeoplePanel } from '../src/components/Account/PeoplePanel';
import { ProfilePanel } from '../src/components/Account/ProfilePanel';
import { AuthProvider } from '../src/lib/auth';
import { InviteRoute } from '../src/routes/InviteRoute';
import { LoginRoute } from '../src/routes/LoginRoute';
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

const SAM: Account = {
  ...ADA,
  id: 'us_00000000000000000000000002',
  email: 'sam@example.com',
  name: 'Sam Rivers',
  handle: 'sam.rivers',
  role: 'member',
  color: '#22c55e',
};

const WORKSPACE: Workspace = {
  id: 'ws_00000000000000000000000001',
  slug: 'docs',
  name: 'Docs',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
};

const INVITE: Invite = {
  id: 'iv_00000000000000000000000001',
  email: 'sam@example.com',
  role: 'member',
  workspaceId: 'ws_00000000000000000000000001',
  createdBy: ADA.id,
  created: '2026-01-01T00:00:00.000Z',
  expires: '2099-01-01T00:00:00.000Z',
  acceptedBy: null,
  accepted: null,
  revoked: false,
};

function authState(patch: Partial<AuthStateResponse> = {}): AuthStateResponse {
  return {
    setupRequired: false,
    user: null,
    ...patch,
  };
}

let server: MockServer | null = null;

function start(routes: MockRoutes): MockServer {
  server = installFetch({ 'GET /api/v1/tree': { spaces: [] }, ...routes });
  return server;
}

/** Everything that reads the sign-in state needs the provider around it. */
function renderWithAuth(ui: React.ReactNode, route = '/'): void {
  renderApp(<AuthProvider>{ui}</AuthProvider>, { route });
}

/** The invite screen reads its token from the path, so it needs a real route around it. */
function renderInvite(token: string): void {
  renderWithAuth(
    <Routes>
      <Route path="/invite/:token" element={<InviteRoute />} />
    </Routes>,
    `/invite/${token}`,
  );
}

function bodyOf(call: { body: unknown }): Record<string, unknown> {
  return (call.body ?? {}) as Record<string, unknown>;
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('the avatar', () => {
  it('draws initials while a person has no picture', () => {
    renderApp(<Avatar person={ADA} />);
    expect(screen.getByLabelText('Ada Lovelace')).toHaveTextContent('AL');
  });

  it('draws the image once there is one, with the rev in the url', () => {
    renderApp(<Avatar person={{ ...ADA, avatarRev: 'abc123' }} />);
    const image = screen.getByAltText('Ada Lovelace');
    expect(image.getAttribute('src')).toBe(`/api/v1/users/${ADA.id}/avatar?v=abc123`);
  });
});

describe('the gate in front of the shell', () => {
  it('shows the sign-in screen while nobody is signed in', async () => {
    start({ 'GET /api/v1/auth/state': authState() });
    renderApp(<App />);

    await screen.findByText('Sign in to edit your docs.');
    expect(screen.queryByRole('button', { name: 'Your account' })).toBeNull();
  });

  it('shows the shell once an account signs in', async () => {
    start({
      'GET /api/v1/auth/state': authState({ user: ADA }),
      'GET /api/v1/workspaces': { workspaces: [WORKSPACE], current: WORKSPACE.slug },
    });
    renderApp(<App />);

    await screen.findByRole('button', { name: 'Your account' });
    expect(screen.queryByText('Sign in to edit your docs.')).toBeNull();
  });
});

describe('the sign-in screen', () => {
  it('claims an unclaimed server, then names the first workspace', async () => {
    const mock = start({
      'GET /api/v1/auth/state': authState({ setupRequired: true }),
      'POST /api/v1/auth/setup': { ok: true, user: ADA },
      'GET /api/v1/workspaces': { workspaces: [WORKSPACE], current: WORKSPACE.slug },
      [`PATCH /api/v1/workspaces/${WORKSPACE.id}`]: { workspace: WORKSPACE },
    });
    const user = userEvent.setup();
    renderWithAuth(<LoginRoute />);

    await screen.findByText('Nobody has claimed this server yet. Create your account to start.');
    await user.type(screen.getByLabelText('Email'), ADA.email);
    await user.type(screen.getByLabelText('Your name'), ADA.name);
    await user.type(screen.getByLabelText('Password'), 'stack-of-pancakes');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.url.pathname === '/api/v1/auth/setup');
      expect(call).toBeDefined();
      expect(bodyOf(call ?? { body: null })).toEqual({
        email: ADA.email,
        name: ADA.name,
        password: 'stack-of-pancakes',
      });
    });

    // The account exists now, so the same card asks for the workspace name.
    await user.type(await screen.findByLabelText('Workspace name'), 'Acme Docs');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.method === 'PATCH');
      expect(bodyOf(call ?? { body: null })).toEqual({ name: 'Acme Docs', slug: 'acme-docs' });
    });
  });

  it('asks for an email once the server has accounts', async () => {
    const mock = start({
      'GET /api/v1/auth/state': authState(),
      'POST /api/v1/auth/login': { ok: true, user: ADA },
    });
    const user = userEvent.setup();
    renderWithAuth(<LoginRoute />);

    await user.type(await screen.findByLabelText('Email'), ADA.email);
    await user.type(screen.getByLabelText('Password'), 'stack-of-pancakes');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.url.pathname === '/api/v1/auth/login');
      expect(bodyOf(call ?? { body: null })).toEqual({
        email: ADA.email,
        password: 'stack-of-pancakes',
      });
    });
  });

  it('keeps the sign-in button dead until an address is given', async () => {
    start({ 'GET /api/v1/auth/state': authState() });
    const user = userEvent.setup();
    renderWithAuth(<LoginRoute />);

    // Every session names an account, so a password on its own gets nobody in.
    await user.type(await screen.findByLabelText('Password'), 'one-shared-secret');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();

    await user.type(screen.getByLabelText('Email'), ADA.email);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});

describe('the invite screen', () => {
  const preview = { email: SAM.email, role: 'member', expires: INVITE.expires, invitedBy: ADA.name };

  it('names the sender, pins the address and signs the person up', async () => {
    const mock = start({
      'GET /api/v1/auth/state': authState(),
      'GET /api/v1/auth/invite/tok-1': preview,
      'POST /api/v1/auth/register': { ok: true, user: SAM },
    });
    const user = userEvent.setup();
    renderInvite('tok-1');

    await screen.findByText(`${ADA.name} invited you to these docs.`);
    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue(SAM.email);
    expect(email).toHaveAttribute('readonly');

    await user.type(screen.getByLabelText('Your name'), SAM.name);
    await user.type(screen.getByLabelText('Password'), 'four-purple-kites');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.url.pathname === '/api/v1/auth/register');
      expect(bodyOf(call ?? { body: null })).toEqual({
        token: 'tok-1',
        name: SAM.name,
        password: 'four-purple-kites',
      });
    });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/'));
  });

  it('asks for an address when the link is not pinned to one', async () => {
    const mock = start({
      'GET /api/v1/auth/state': authState(),
      'GET /api/v1/auth/invite/tok-2': { ...preview, email: null, invitedBy: null },
      'POST /api/v1/auth/register': { ok: true, user: SAM },
    });
    const user = userEvent.setup();
    renderInvite('tok-2');

    await screen.findByText('You are invited to these docs.');
    await user.type(screen.getByLabelText('Email'), SAM.email);
    await user.type(screen.getByLabelText('Your name'), SAM.name);
    await user.type(screen.getByLabelText('Password'), 'four-purple-kites');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.url.pathname === '/api/v1/auth/register');
      expect(bodyOf(call ?? { body: null })).toMatchObject({ email: SAM.email, token: 'tok-2' });
    });
  });

  it('says so when the link is spent', async () => {
    start({ 'GET /api/v1/auth/state': authState() });
    renderInvite('gone');

    await screen.findByText('This invite link is not valid any more.');
  });
});

describe('the account menu', () => {
  it('stays out of the way until the account lands', async () => {
    start({ 'GET /api/v1/auth/state': authState() });
    const { container } = renderApp(
      <AuthProvider>
        <AccountMenu />
      </AuthProvider>,
    );

    await waitFor(() => expect(container.querySelector('.account-menu')).toBeNull());
  });

  it('offers two things and nothing else, whoever is signed in', async () => {
    start({ 'GET /api/v1/auth/state': authState({ user: SAM }) });
    const user = userEvent.setup();
    renderWithAuth(<AccountMenu />);

    await user.click(await screen.findByRole('button', { name: 'Your account' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Settings',
      'Log out',
    ]);
  });

  // The sidebar clipped a panel drawn inside it, and the panel is nearly as wide as the sidebar.
  // Where it lands is menuPlacement's job; that it hangs off the body is this component's.
  it('opens the panel in a layer on the body', async () => {
    start({ 'GET /api/v1/auth/state': authState({ user: ADA }) });
    const user = userEvent.setup();
    renderWithAuth(<AccountMenu />);
    await user.click(await screen.findByRole('button', { name: 'Your account' }));

    expect(screen.getByRole('menu').parentElement).toBe(document.body);
  });

  it('sends you to the settings page', async () => {
    start({ 'GET /api/v1/auth/state': authState({ user: ADA }) });
    const user = userEvent.setup();
    renderWithAuth(<AccountMenu />);

    await user.click(await screen.findByRole('button', { name: 'Your account' }));
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });

  it('shows who is signed in, and reloads after a sign-out', async () => {
    const mock = start({
      'GET /api/v1/auth/state': authState({ user: ADA }),
      'POST /api/v1/auth/logout': { ok: true },
    });
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    } as unknown as Location);

    const user = userEvent.setup();
    renderWithAuth(<AccountMenu />);

    await user.click(await screen.findByRole('button', { name: 'Your account' }));
    expect(screen.getByText(ADA.email)).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Log out' }));
    await waitFor(() => {
      expect(mock.calls.some((item) => item.url.pathname === '/api/v1/auth/logout')).toBe(true);
      expect(assign).toHaveBeenCalledWith('/');
    });
  });
});

describe('the profile panel', () => {
  it('saves a new display name when the field loses focus', async () => {
    const mock = start({
      'GET /api/v1/auth/state': authState({ user: ADA }),
      'PATCH /api/v1/me': { user: { ...ADA, name: 'Ada L' } },
    });
    const user = userEvent.setup();
    renderWithAuth(<ProfilePanel user={ADA} />);

    const field = screen.getByLabelText('Display name');
    await user.clear(field);
    await user.type(field, 'Ada L');
    await user.tab();

    await waitFor(() => {
      const call = mock.calls.find((item) => item.url.pathname === '/api/v1/me');
      expect(bodyOf(call ?? { body: null })).toEqual({ name: 'Ada L' });
    });
  });

  it('changes a password only once both fields are long enough', async () => {
    const mock = start({
      'GET /api/v1/auth/state': authState({ user: ADA }),
      'POST /api/v1/me/password': { ok: true },
    });
    const user = userEvent.setup();
    renderWithAuth(<ProfilePanel user={ADA} />);

    const submit = screen.getByRole('button', { name: 'Change password' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Current password'), 'stack-of-pancakes');
    await user.type(screen.getByLabelText('New password'), 'short');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('New password'), '-but-longer');
    await user.click(submit);

    await waitFor(() => {
      const call = mock.calls.find((item) => item.url.pathname === '/api/v1/me/password');
      expect(bodyOf(call ?? { body: null })).toEqual({
        current: 'stack-of-pancakes',
        next: 'short-but-longer',
      });
    });
  });

  it('offers no way to remove a picture that is not there', () => {
    start({ 'GET /api/v1/auth/state': authState({ user: ADA }) });
    renderWithAuth(<ProfilePanel user={ADA} />);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('offers to remove a picture once there is one', () => {
    start({ 'GET /api/v1/auth/state': authState({ user: ADA }) });
    renderWithAuth(<ProfilePanel user={{ ...ADA, avatarRev: 'abc123' }} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

describe('the people panel', () => {
  const routes: MockRoutes = {
    'GET /api/v1/auth/state': authState({ user: ADA }),
    'GET /api/v1/users': { users: [ADA, SAM] },
    'GET /api/v1/invites': { invites: [INVITE] },
  };

  it('creates a link and shows it once', async () => {
    const mock = start({
      ...routes,
      'POST /api/v1/invites': { invite: INVITE, url: 'http://localhost/invite/tok-9' },
    });
    const user = userEvent.setup();
    renderWithAuth(<PeoplePanel me={ADA} />);

    await user.type(screen.getByPlaceholderText('name@example.com (optional)'), SAM.email);
    await user.selectOptions(screen.getByLabelText('Role'), 'admin');
    await user.click(screen.getByRole('button', { name: 'Create link' }));

    await screen.findByText('http://localhost/invite/tok-9');
    const call = mock.calls.find((item) => item.method === 'POST' && item.url.pathname === '/api/v1/invites');
    expect(bodyOf(call ?? { body: null })).toEqual({ role: 'admin', email: SAM.email });
  });

  it('lists everybody and refuses to remove you', async () => {
    start(routes);
    renderWithAuth(<PeoplePanel me={ADA} />);

    await screen.findByText(`${ADA.name} (you)`);
    expect(screen.getByText(SAM.name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Remove ${ADA.name}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Remove ${SAM.name}` })).toBeEnabled();
  });

  it('changes a role', async () => {
    const mock = start({ ...routes, 'PATCH /api/v1/users/us_00000000000000000000000002': { user: SAM } });
    const user = userEvent.setup();
    renderWithAuth(<PeoplePanel me={ADA} />);

    await user.selectOptions(await screen.findByLabelText(`Role of ${SAM.name}`), 'admin');

    await waitFor(() => {
      const call = mock.calls.find((item) => item.method === 'PATCH');
      expect(call?.url.pathname).toBe(`/api/v1/users/${SAM.id}`);
      expect(bodyOf(call ?? { body: null })).toEqual({ role: 'admin' });
    });
  });

  it('shows an invite that is still waiting, and revokes it', async () => {
    const mock = start({
      ...routes,
      'DELETE /api/v1/invites/iv_00000000000000000000000001': { ok: true },
    });
    const user = userEvent.setup();
    renderWithAuth(<PeoplePanel me={ADA} />);

    const section = await screen.findByText('Invites waiting');
    expect(section).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revoke this invite' }));
    await waitFor(() => {
      expect(mock.calls.some((item) => item.method === 'DELETE')).toBe(true);
    });
  });

  it('hides an invite that is already used', async () => {
    start({ ...routes, 'GET /api/v1/invites': { invites: [{ ...INVITE, acceptedBy: SAM.id }] } });
    renderWithAuth(<PeoplePanel me={ADA} />);

    await screen.findByText(SAM.name);
    expect(screen.queryByText('Invites waiting')).toBeNull();
  });
});

describe('the roster rows', () => {
  it('names each person beside their own avatar', async () => {
    start({
      'GET /api/v1/auth/state': authState({ user: ADA }),
      'GET /api/v1/users': { users: [SAM] },
      'GET /api/v1/invites': { invites: [] },
    });
    renderWithAuth(<PeoplePanel me={ADA} />);

    const row = (await screen.findByText(SAM.name)).closest('.people-row');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByLabelText(SAM.name)).toHaveTextContent('SR');
  });
});
