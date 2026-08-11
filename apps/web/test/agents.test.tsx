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
  color: '#3b82f6',
  avatarRev: null,
  webhookUrl: null,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  lastUsed: null,
};

const MCP_URL = 'http://localhost:8080/api/v1/mcp';

const SIGNING = {
  enabled: true,
  algorithm: 'hmac-sha256',
  keyId: '0123456789abcdef',
  signatureHeader: 'x-tablinum-signature',
  eventHeader: 'x-tablinum-event',
  deliveryHeader: 'x-tablinum-delivery',
  toleranceSeconds: 300,
};

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
    'GET /api/v1/webhooks/signing': SIGNING,
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

  it('lists each agent with its name, its handle and its last use', async () => {
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
    expect(screen.getByText('Release Bot')).toBeInTheDocument();
    expect(screen.getByText(/@doc\.bot · never connected/)).toBeInTheDocument();
    expect(screen.getByText(/@release\.bot · last seen/)).toBeInTheDocument();
    // Its initials stand in until somebody gives it a picture.
    expect(screen.getByLabelText('Doc Bot')).toHaveTextContent('DB');
  });

  it('draws the picture an agent has, in place of its initials', async () => {
    start({ 'GET /api/v1/agents': { agents: [{ ...DOC_BOT, avatarRev: 'rev1' }] } });
    renderPanel();

    const image = await screen.findByAltText('Doc Bot');
    expect(image).toHaveAttribute('src', `/api/v1/agents/${DOC_BOT.id}/avatar?v=rev1`);
  });

  it('uploads a picture for an agent', async () => {
    const mock = start({
      ...routes,
      'POST /api/v1/agents/ag_00000000000000000000000001/avatar': {
        url: `/api/v1/agents/${DOC_BOT.id}/avatar?v=rev1`,
        rev: 'rev1',
      },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Edit Doc Bot' }));
    const file = new File(['png'], 'bot.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Picture of Doc Bot'), file);

    await waitFor(() => {
      const call = mock.calls.find((item) => item.method === 'POST');
      expect(call?.url.pathname).toBe(`/api/v1/agents/${DOC_BOT.id}/avatar`);
    });
  });

  it('removes the picture of an agent that has one', async () => {
    const mock = start({
      'GET /api/v1/agents': { agents: [{ ...DOC_BOT, avatarRev: 'rev1' }] },
      'DELETE /api/v1/agents/ag_00000000000000000000000001/avatar': { ok: true },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Edit Doc Bot' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.method === 'DELETE');
      expect(call?.url.pathname).toBe(`/api/v1/agents/${DOC_BOT.id}/avatar`);
    });
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
      expect(bodyOf(call)).toEqual({
        name: 'Doc Bot',
        identity: 'You only write release notes.',
        webhookUrl: null,
      });
    });
  });

  // Deleting an agent is what stops it, so there is nothing to pause and nothing to switch on.
  it('offers no active or paused state at all', async () => {
    start(routes);
    renderPanel();

    await screen.findByText('Doc Bot');
    expect(screen.queryByLabelText('State of Doc Bot')).toBeNull();
    expect(screen.queryByRole('option', { name: 'Paused' })).toBeNull();
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

  it('sends the webhook address it is given, and says how a delivery is signed', async () => {
    const mock = start({
      ...routes,
      'POST /api/v1/agents': { agent: DOC_BOT, token: 'gda_secret-token', url: MCP_URL },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Agent name'), 'Doc Bot');
    await user.type(screen.getByLabelText('Agent webhook URL'), 'https://bot.example.com/hook');
    await screen.findByText(/hmac-sha256/);
    await user.click(screen.getByRole('button', { name: 'Add agent' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.method === 'POST');
      expect(bodyOf(call)).toEqual({
        name: 'Doc Bot',
        identity: '',
        webhookUrl: 'https://bot.example.com/hook',
      });
    });
  });

  it('refuses an address that is not a http or https URL', async () => {
    const mock = start(routes);
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Agent name'), 'Doc Bot');
    await user.type(screen.getByLabelText('Agent webhook URL'), 'bot.example.com/hook');
    await user.click(screen.getByRole('button', { name: 'Add agent' }));

    await screen.findByText('The webhook address must start with http:// or https://.');
    expect(mock.calls.some((item) => item.method === 'POST')).toBe(false);
  });

  it('says that nothing is delivered while the server has no signing secret', async () => {
    start({ ...routes, 'GET /api/v1/webhooks/signing': { ...SIGNING, enabled: false, keyId: null } });
    renderPanel();

    await screen.findByText(/TABLINUM_WEBHOOK_SECRET/);
  });

  it('edits the webhook address of an agent, and takes it away again', async () => {
    const hooked: Agent = { ...DOC_BOT, webhookUrl: 'https://bot.example.com/hook' };
    const mock = start({
      'GET /api/v1/agents': { agents: [hooked] },
      'PATCH /api/v1/agents/ag_00000000000000000000000001': { agent: hooked },
    });
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText(/notified by webhook/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Doc Bot' }));
    const field = screen.getByLabelText('Webhook URL of Doc Bot');
    expect(field).toHaveValue('https://bot.example.com/hook');

    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = mock.calls.find((item) => item.method === 'PATCH');
      expect(bodyOf(call).webhookUrl).toBeNull();
    });
  });

  it('says so when there are no agents at all', async () => {
    start({ 'GET /api/v1/agents': { agents: [] } });
    renderPanel();
    await screen.findByText('No agents yet.');
  });
});
