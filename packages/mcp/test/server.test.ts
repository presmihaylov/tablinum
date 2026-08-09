import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { TablinumClient } from '../src/client.js';
import {
  STYLE_GUIDE_PROMPT,
  TREE_RESOURCE_URI,
  createTablinumMcpServer,
} from '../src/server.js';
import { TOOL_SPECS } from '../src/tools.js';
import { makeNode, makePage, makeSpaceTree, mockFetch, reply, type Routes } from './helpers.js';

const BASE = 'http://tablinum.test';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function connect(routes: Routes) {
  const mock = mockFetch(routes);
  const server = createTablinumMcpServer({
    client: new TablinumClient({ baseUrl: BASE, token: 'tok_1', fetch: mock.fetch }),
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, server, mock };
}

function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const first = content[0];
  if (first === undefined || first.type !== 'text' || first.text === undefined) {
    throw new Error(`expected a text content block, got ${JSON.stringify(content)}`);
  }
  return first.text;
}

const TREE_ROUTES: Routes = {
  'GET /api/v1/tree': {
    spaces: [makeSpaceTree({ tree: [makeNode({ path: 'eng/deploy', title: 'Deploy' })] })],
  },
};

describe('MCP server wiring', () => {
  it('advertises every tool with a description and an object input schema', async () => {
    const { client } = await connect({});

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    expect(names).toEqual(TOOL_SPECS.map((spec) => spec.name).sort());
    for (const tool of listed.tools) {
      expect(tool.description ?? '').not.toBe('');
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('returns tool output as a single text block', async () => {
    const page = makePage({ markdown: '## Steps\n\nDo it.\n' });
    const { client } = await connect({ 'GET /api/v1/pages': { page } });

    const result = await client.callTool({
      name: 'tablinum_get_page',
      arguments: { path: 'eng/deploy' },
    });

    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain('## Steps\n\nDo it.\n');
  });

  it('turns an API error into an isError result naming the code and the next step', async () => {
    const { client } = await connect({
      'GET /api/v1/pages': reply(404, {
        error: { code: 'NOT_FOUND', message: 'No page at eng/nope' },
      }),
    });

    const result = await client.callTool({
      name: 'tablinum_get_page',
      arguments: { path: 'eng/nope' },
    });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain('NOT_FOUND: No page at eng/nope');
    expect(text).toContain('tablinum_search');
  });

  it('turns a missing id-or-path into a VALIDATION result instead of a crash', async () => {
    const { client, mock } = await connect({});

    const result = await client.callTool({ name: 'tablinum_get_page', arguments: {} });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });

  it('serves the tablinum://tree resource', async () => {
    const { client } = await connect(TREE_ROUTES);

    const listed = await client.listResources();
    expect(listed.resources.map((resource) => resource.uri)).toContain(TREE_RESOURCE_URI);

    const read = await client.readResource({ uri: TREE_RESOURCE_URI });
    const first = read.contents[0];
    expect(first?.mimeType).toBe('text/markdown');
    expect(String(first?.text)).toContain('[eng/deploy]');
  });

  it('serves the tablinum_style_guide prompt', async () => {
    const { client } = await connect({});

    const listed = await client.listPrompts();
    expect(listed.prompts.map((prompt) => prompt.name)).toContain(STYLE_GUIDE_PROMPT);

    const prompt = await client.getPrompt({ name: STYLE_GUIDE_PROMPT, arguments: {} });
    const message = prompt.messages[0];
    expect(message?.role).toBe('user');
    expect(String((message?.content as { text?: string }).text)).toContain('How to write pages');
  });

  it('adds space guidance when the prompt receives a space', async () => {
    const { client } = await connect({});

    const prompt = await client.getPrompt({
      name: STYLE_GUIDE_PROMPT,
      arguments: { space: 'eng' },
    });

    const text = String((prompt.messages[0]?.content as { text?: string }).text);
    expect(text).toContain('For the "eng" space');
    expect(text).toContain('eng/...');
  });

  it('reports server instructions that point at the discovery tools', async () => {
    const { client } = await connect({});
    expect(client.getInstructions() ?? '').toContain('tablinum_search');
  });
});
