import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Account, Agent, AuthStateResponse } from '@tablinum/shared';
import { AgentsPanel } from '../src/components/Account/AgentsPanel';
import { AuthProvider } from '../src/lib/auth';
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

const DOC_BOT: Agent = {
  id: 'ag_00000000000000000000000001',
  workspaceId: 'ws_00000000000000000000000001',
  name: 'Doc Bot',
  handle: 'doc.bot',
  identity: 'You keep the runbooks tidy.',
  disabled: false,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  lastUsed: null,
};

const MCP_URL = 'http://localhost:8080/api/v1/mcp';

function authState(patch: Partial<AuthStateResponse> = {}): AuthStateResponse {
  return {
    setupRequired: false,
    user: ADA,
    ...patch,
  };
}

let server: MockServer | null = null;

function start(routes: MockRoutes): MockServer {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [] },
    'GET /api/v1/auth/state': authState(),
    ...routes,
  });
  return server;
}

function renderPanel(): void {
  renderApp(
    <AuthProvider>
      <AgentsPanel />
    </AuthProvider>,
  );
}

function bodyOf(call: { body: unknown } | undefined): Record<string, unknown> {
  return (call?.body ?? {}) as Record<string, unknown>;
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('the agents dialog', () => {
  const routes: MockRoutes = { 'GET /api/v1/agents': { agents: [DOC_BOT] } };

  it('adds an agent with an identity and shows the token exactly once', async () => {
    const mock = start({
      ...routes,
      'POST /api/v1/agents': { agent: DOC_BOT, token: 'gda_secret-token', url: MCP_URL },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Agent name'), 'Doc Bot');
    await user.type(screen.getByLabelText('Agent identity'), 'You keep the runbooks tidy.');
    await user.click(screen.getByRole('button', { name: 'Add agent' }));

    await screen.findByText('gda_secret-token');
    expect(screen.getByText(MCP_URL)).toBeInTheDocument();

    const call = mock.calls.find((item) => item.method === 'POST');
    expect(bodyOf(call)).toEqual({ name: 'Doc Bot', identity: 'You keep the runbooks tidy.' });

    await user.click(screen.getByRole('button', { name: 'I have copied it' }));
    expect(screen.queryByText('gda_secret-token')).toBeNull();
  });

  it('refuses to add an agent with no name', async () => {
    const mock = start(routes);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await screen.findByText('Give the agent a name.');
    expect(mock.calls.some((item) => item.method === 'POST')).toBe(false);
  });

  it('lists each agent with its handle and its last use', async () => {
    const busy: Agent = {
      ...DOC_BOT,
      id: 'ag_00000000000000000000000002',
      name: 'Release Bot',
      handle: 'release.bot',
      lastUsed: new Date().toISOString(),
    };
    start({ 'GET /api/v1/agents': { agents: [DOC_BOT, busy] } });
    renderPanel();

    await screen.findByText('Doc Bot');
    expect(screen.getByText(/@doc\.bot · never connected/)).toBeInTheDocument();
    expect(screen.getByText(/@release\.bot · last seen/)).toBeInTheDocument();
  });

  it('saves a changed identity', async () => {
    const mock = start({
      ...routes,
      'PATCH /api/v1/agents/ag_00000000000000000000000001': { agent: DOC_BOT },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Edit Doc Bot' }));
    const field = screen.getByLabelText('Identity of Doc Bot');
    await user.clear(field);
    await user.type(field, 'You only write release notes.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.method === 'PATCH');
      expect(call?.url.pathname).toBe(`/api/v1/agents/${DOC_BOT.id}`);
      expect(bodyOf(call)).toEqual({ name: 'Doc Bot', identity: 'You only write release notes.' });
    });
  });

  it('pauses an agent', async () => {
    const mock = start({
      ...routes,
      'PATCH /api/v1/agents/ag_00000000000000000000000001': { agent: { ...DOC_BOT, disabled: true } },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(await screen.findByLabelText('State of Doc Bot'), 'paused');

    await waitFor(() => {
      const call = mock.calls.find((item) => item.method === 'PATCH');
      expect(bodyOf(call)).toEqual({ disabled: true });
    });
  });

  it('asks before it issues a new token, then shows the new one', async () => {
    const mock = start({
      ...routes,
      'POST /api/v1/agents/ag_00000000000000000000000001/token': {
        agent: DOC_BOT,
        token: 'gda_the-next-token',
        url: MCP_URL,
      },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Issue a new token for Doc Bot' }));
    expect(mock.calls.some((item) => item.method === 'POST')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'New token' }));
    await screen.findByText('gda_the-next-token');
  });

  it('asks before it deletes an agent', async () => {
    const mock = start({
      ...routes,
      'DELETE /api/v1/agents/ag_00000000000000000000000001': { ok: true },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Delete Doc Bot' }));
    expect(mock.calls.some((item) => item.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(mock.calls.some((item) => item.method === 'DELETE')).toBe(true);
    });
  });

  it('says so when there are no agents at all', async () => {
    start({ 'GET /api/v1/agents': { agents: [] } });
    renderPanel();
    await screen.findByText('No agents yet.');
  });
});
