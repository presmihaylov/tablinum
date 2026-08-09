import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from '@fastify/websocket';
import {
  AGENT_TOKEN_PREFIX,
  AgentTokenResponseSchema,
  AgentResponseSchema,
  AgentsResponseSchema,
  ErrorBodySchema,
  PageResponseSchema,
  type ServerMessage,
} from '@tablinum/shared';
import { contextOf } from '../src/context.js';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

/** Stands in for a browser tab, so a test can read what the live channel sent it. */
class FakeSocket {
  readonly sent: ServerMessage[] = [];

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }

  close(): void {
    // A test never closes this socket; the harness drops the whole hub instead.
  }

  last(type: ServerMessage['type']): ServerMessage | undefined {
    return [...this.sent].reverse().find((message) => message.type === type);
  }
}

function asSocket(socket: FakeSocket): WebSocket {
  return socket as unknown as WebSocket;
}

async function addAgent(name = 'Doc Bot', identity = 'You keep the runbooks tidy.') {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    headers: harness.authHeaders(),
    payload: { name, identity },
  });
  expect(response.statusCode).toBe(200);
  return bodyOf(response, AgentTokenResponseSchema);
}

describe('agents', () => {
  it('creates an agent with a handle, an identity and a token shown once', async () => {
    const created = await addAgent();
    expect(created.agent.name).toBe('Doc Bot');
    expect(created.agent.handle).toBe('doc.bot');
    expect(created.agent.identity).toBe('You keep the runbooks tidy.');
    expect(created.agent.lastUsed).toBeNull();
    expect(created.token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(created.url).toMatch(/\/api\/v1\/mcp$/);

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/agents',
      headers: harness.authHeaders(),
    });
    const agents = bodyOf(listed, AgentsResponseSchema).agents;
    expect(agents.map((agent) => agent.id)).toEqual([created.agent.id]);
    // The token is only ever stored hashed, so nothing in the listing can leak it.
    expect(JSON.stringify(agents)).not.toContain(created.token);
  });

  it('gives an agent token the run of the pages but not of the admin routes', async () => {
    const { token } = await addAgent();
    const headers = { authorization: `Bearer ${token}` };

    const space = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers,
      payload: { slug: 'eng', name: 'Engineering' },
    });
    expect(space.statusCode).toBe(200);

    const page = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers,
      payload: { path: 'eng/notes', title: 'Notes', markdown: 'Written by a robot.' },
    });
    expect(page.statusCode).toBe(201);
    expect(bodyOf(page, PageResponseSchema).page.path).toBe('eng/notes');

    const forbidden = await harness.app.inject({ method: 'GET', url: '/api/v1/agents', headers });
    expect(forbidden.statusCode).toBe(401);
    expect(bodyOf(forbidden, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');
  });

  it('records when the token was last used', async () => {
    const { agent, token } = await addAgent();
    await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: { authorization: `Bearer ${token}` },
    });

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/agents',
      headers: harness.authHeaders(),
    });
    const found = bodyOf(listed, AgentsResponseSchema).agents.find((one) => one.id === agent.id);
    expect(found?.lastUsed).not.toBeNull();
  });

  it('changes the identity and switches the agent off', async () => {
    const { agent, token } = await addAgent();

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agent.id}`,
      headers: harness.authHeaders(),
      payload: { identity: 'You only write release notes.' },
    });
    expect(bodyOf(patched, AgentResponseSchema).agent.identity).toBe('You only write release notes.');

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agent.id}`,
      headers: harness.authHeaders(),
      payload: { disabled: true },
    });
    const blocked = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(blocked.statusCode).toBe(401);
  });

  it('rotates the token, which retires the old one at once', async () => {
    const { agent, token } = await addAgent();

    const rotated = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agent.id}/token`,
      headers: harness.authHeaders(),
    });
    const next = bodyOf(rotated, AgentTokenResponseSchema);
    expect(next.token).not.toBe(token);

    const stale = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stale.statusCode).toBe(401);

    const fresh = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: { authorization: `Bearer ${next.token}` },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('deletes an agent and answers NOT_FOUND for an unknown one', async () => {
    const { agent, token } = await addAgent();

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agent.id}`,
      headers: harness.authHeaders(),
    });
    expect(removed.statusCode).toBe(200);

    const gone = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(gone.statusCode).toBe(401);

    const again = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agent.id}`,
      headers: harness.authHeaders(),
    });
    expect(again.statusCode).toBe(404);
    expect(bodyOf(again, ErrorBodySchema).error.code).toBe('NOT_FOUND');
  });

  it('sits an agent on the page it works on, and names it on the broadcast', async () => {
    const { pageIds } = await seed(harness);
    const id = pageIds[0];
    const { agent, token } = await addAgent('Ada Writer');
    const headers = { authorization: `Bearer ${token}` };

    const ctx = contextOf(harness.app);
    if (ctx === null) throw new Error('the harness built no route context');

    const socket = new FakeSocket();
    ctx.live.join('tab-a', asSocket(socket));

    const read = await harness.app.inject({ method: 'GET', url: `/api/v1/pages/${id}`, headers });
    expect(read.statusCode).toBe(200);
    const path = bodyOf(read, PageResponseSchema).page.path;
    // The live channel carries only what a chip needs, never the whole agent record.
    const seated = { id: agent.id, name: 'Ada Writer', handle: 'ada.writer' };
    expect(ctx.live.presence(path)).toEqual([
      { id: agent.id, name: 'Ada Writer', color: expect.any(String), editing: false, agent: seated },
    ]);

    const written = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}`,
      headers,
      payload: { markdown: '# Deploy\n\nThe agent tidied this up.' },
    });
    expect(written.statusCode).toBe(200);

    // The chip pulses only once the agent has written, not while it reads.
    expect(ctx.live.presence(path)[0]?.editing).toBe(true);

    const broadcast = socket.last('page');
    expect(broadcast).toMatchObject({ type: 'page', path, source: 'api', agent: seated });
  });

  it('takes an agent off its page when the agent is deleted', async () => {
    const { pageIds } = await seed(harness);
    const { agent, token } = await addAgent('Ada Writer');

    const ctx = contextOf(harness.app);
    if (ctx === null) throw new Error('the harness built no route context');

    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${pageIds[0]}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const path = bodyOf(read, PageResponseSchema).page.path;
    expect(ctx.live.presence(path)).toHaveLength(1);

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agent.id}`,
      headers: harness.authHeaders(),
    });
    expect(removed.statusCode).toBe(200);
    expect(ctx.live.presence(path)).toEqual([]);
  });

  it('keeps handles unique across people and agents', async () => {
    harness.accounts.createUser({
      email: 'doc.bot@example.com',
      name: 'Doc Bot',
      password: 'correct horse battery',
    });
    const created = await addAgent();
    expect(created.agent.handle).toBe('doc.bot.2');
  });
});
