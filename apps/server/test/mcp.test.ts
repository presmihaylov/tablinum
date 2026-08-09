import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentTokenResponseSchema, PageListResponseSchema } from '@tablinum/shared';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

/** The transport insists on both content types, exactly as a real MCP client sends them. */
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

const RpcErrorSchema = z.object({
  jsonrpc: z.literal('2.0'),
  error: z.object({ code: z.number(), message: z.string() }),
});

const InitializeSchema = z.object({
  result: z.object({
    protocolVersion: z.string(),
    serverInfo: z.object({ name: z.string(), version: z.string() }),
    instructions: z.string().optional(),
  }),
});

const ToolsListSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string(), description: z.string() })) }),
});

const ToolCallSchema = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
    isError: z.boolean().optional(),
  }),
});

let nextId = 0;

async function rpc(
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  nextId += 1;
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/mcp',
    headers: { ...MCP_HEADERS, ...headers },
    payload: { jsonrpc: '2.0', id: nextId, method, params },
  });
}

async function agentHeaders(identity = 'You keep the runbooks tidy.'): Promise<Record<string, string>> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    headers: harness.authHeaders(),
    payload: { name: 'Doc Bot', identity },
  });
  const { token } = bodyOf(created, AgentTokenResponseSchema);
  return { authorization: `Bearer ${token}` };
}

/** The text of a tool result, joined, so a test can assert on what the agent reads. */
function textOf(response: { body: string }): string {
  const parsed = bodyOf(response, ToolCallSchema);
  expect(parsed.result.isError ?? false).toBe(false);
  return parsed.result.content.map((part) => part.text ?? '').join('\n');
}

const INITIALIZE = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'tablinum-test-client', version: '0.0.0' },
};

describe('remote MCP endpoint', () => {
  it('hands the agent its own identity in the handshake instructions', async () => {
    const headers = await agentHeaders();
    const response = await rpc('initialize', INITIALIZE, headers);
    expect(response.statusCode).toBe(200);

    const { result } = bodyOf(response, InitializeSchema);
    expect(result.serverInfo.name).toBe('tablinum');
    expect(result.instructions).toContain('You are connected to tablinum as "Doc Bot" (@doc.bot).');
    expect(result.instructions).toContain('You keep the runbooks tidy.');
    // The shared tool guidance still follows the brief.
    expect(result.instructions).toContain('tablinum_search');
  });

  it('leaves the instructions alone for a credential that names no agent', async () => {
    const response = await rpc('initialize', INITIALIZE, harness.authHeaders());
    const { result } = bodyOf(response, InitializeSchema);
    expect(result.instructions).not.toContain('You are connected to tablinum as');
    expect(result.instructions).toContain('tablinum_search');
  });

  it('lists the tablinum tools', async () => {
    const response = await rpc('tools/list', {}, await agentHeaders());
    const names = bodyOf(response, ToolsListSchema).result.tools.map((tool) => tool.name);
    expect(names).toContain('tablinum_search');
    expect(names).toContain('tablinum_create_page');
    expect(names).toContain('tablinum_list_tree');
  });

  it('runs a read tool through the loopback client', async () => {
    await seed(harness);
    const response = await rpc(
      'tools/call',
      { name: 'tablinum_list_tree', arguments: { space: 'eng' } },
      await agentHeaders(),
    );
    expect(textOf(response)).toContain('eng/deploy');
  });

  it('writes a real page when an agent calls a write tool', async () => {
    await seed(harness);
    const call = await rpc(
      'tools/call',
      {
        name: 'tablinum_create_page',
        arguments: { path: 'eng/rollback', title: 'Rollback', markdown: 'Undo the release.' },
      },
      await agentHeaders(),
    );
    expect(textOf(call)).toContain('eng/rollback');

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: harness.authHeaders(),
    });
    const paths = bodyOf(listed, PageListResponseSchema).pages.map((page) => page.path);
    expect(paths).toContain('eng/rollback');
  });

  it('reports a tool failure to the caller instead of crashing', async () => {
    const response = await rpc(
      'tools/call',
      { name: 'tablinum_list_tree', arguments: { space: 'nope' } },
      await agentHeaders(),
    );
    const parsed = bodyOf(response, ToolCallSchema);
    expect(parsed.result.isError).toBe(true);
    expect(parsed.result.content.map((part) => part.text ?? '').join('\n')).toContain('nope');
  });

  it('refuses a disabled agent and a request with no credential', async () => {
    const anonymous = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(anonymous.statusCode).toBe(401);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: harness.authHeaders(),
      payload: { name: 'Idle Bot' },
    });
    const { agent, token } = bodyOf(created, AgentTokenResponseSchema);
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agent.id}`,
      headers: harness.authHeaders(),
      payload: { disabled: true },
    });

    const blocked = await rpc('tools/list', {}, { authorization: `Bearer ${token}` });
    expect(blocked.statusCode).toBe(401);
  });

  it('answers 405 on GET, because the stateless server pushes nothing', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/mcp',
      headers: { ...MCP_HEADERS, ...harness.authHeaders() },
    });
    expect(response.statusCode).toBe(405);
  });

  it('rejects a body that is not a JSON-RPC message', async () => {
    const response = await rpc('tools/list', {}, await agentHeaders());
    expect(response.statusCode).toBe(200);

    const junk = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { ...MCP_HEADERS, ...(await agentHeaders('')) },
      payload: { hello: 'there' },
    });
    expect(junk.statusCode).toBe(400);
    expect(bodyOf(junk, RpcErrorSchema).error.code).toBeLessThan(0);
  });
});
