import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test, uniqueSlug, BASE_URL } from './fixtures';

/**
 * An agent works on a page the way a person does.
 *
 * It opens the page, puts a caret on it, selects a phrase and types over it. Everything here
 * goes through the remote MCP endpoint, so the whole path is real: the tool, the loopback call,
 * the REST layer, the file on disk, and the caret every open tab draws.
 */

const MARKDOWN = '# Release\n\nRun the pipeline from main.\n';
const LINE = 'Run the pipeline from main.';

/** The transport insists on both content types, exactly as a real MCP client sends them. */
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

interface ToolResult {
  result?: { content?: Array<{ text?: string }>; isError?: boolean };
  error?: { message: string };
}

/** One MCP tool call, and the text the agent reads back from it. */
async function callTool(
  agent: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await agent.post('/api/v1/mcp', {
    headers: MCP_HEADERS,
    data: { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.ok(), await response.text()).toBeTruthy();

  const body = (await response.json()) as ToolResult;
  expect(body.error?.message ?? null).toBeNull();
  const text = (body.result?.content ?? []).map((part) => part.text ?? '').join('\n');
  expect(body.result?.isError ?? false, text).toBe(false);
  return text;
}

/** The caret one agent is showing, found by the name written on it. */
function caretOf(page: Page, name: string) {
  return page.locator('.gd-caret__name', { hasText: name });
}

test.describe('an agent editing a page', () => {
  test('opens a page, selects a phrase, and types over it while a reader watches', async ({
    page,
    api,
    request,
    playwright,
  }) => {
    const name = `Scribe ${uniqueSlug('a')}`;
    const made = await request.post('/api/v1/agents', {
      data: { name, identity: 'You keep the release notes tidy.' },
    });
    expect(made.ok(), await made.text()).toBeTruthy();
    const { agent, token } = (await made.json()) as { agent: { id: string }; token: string };

    const space = await api.createUniqueSpace('agent-edit');
    const path = `${space.slug}/release`;
    const created = await api.createPage({ path, title: 'Release', markdown: MARKDOWN });

    const asAgent = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { authorization: `Bearer ${token}` },
    });

    try {
      // A reader has the page open before the agent touches anything.
      await page.goto(`/p/${path}`);
      await expect(page.locator('.gd-editor-surface')).toContainText(LINE);

      // Opening the page shows it as numbered blocks and puts the caret at the top.
      const opened = await callTool(asAgent, 'tablinum_open_page', { path });
      expect(opened).toContain('0 | # Release');
      expect(opened).toContain(`1 | ${LINE}`);

      // The caret reaches the reader's screen with the agent's name on it.
      await expect(caretOf(page, name)).toBeVisible();

      const selected = await callTool(asAgent, 'tablinum_select', { path, find: 'from main' });
      expect(selected).toContain('from main');

      await callTool(asAgent, 'tablinum_type', { path, text: 'from the release branch' });

      // The reader sees the new words without reloading anything. The agent's caret stands where
      // it stopped typing, which is between the last word and the full stop, and the name on it
      // counts as text on the page. So the words are matched up to that point, and the full stop
      // is left to the assertion on the file below, which no caret can reach.
      await expect(page.locator('.gd-editor-surface')).toContainText(
        'Run the pipeline from the release branch',
      );

      // And the file really says so.
      const after = await api.getPage(path);
      expect(after?.markdown).toContain('Run the pipeline from the release branch.');
      expect(after?.markdown).not.toContain('from main');

      // The caret came back with the text, just after what was typed. Read on a poll: the type
      // call answers when the write is done, and the caret is recorded on its own path, so a
      // single read here is a point measurement of state that is still on its way.
      type Caret = { block: number; offset: number };
      await expect
        .poll(async () => {
          const held = await asAgent.get(`/api/v1/pages/${created.id}/cursor`);
          if (!held.ok()) return null;
          const { cursor } = (await held.json()) as {
            cursor: { anchor: Caret; head: Caret } | null;
          };
          return cursor?.head ?? null;
        })
        // Just after the words it typed, which is where a person's caret ends up.
        .toEqual({ block: 1, offset: 'Run the pipeline from the release branch'.length });
    } finally {
      await asAgent.dispose();
      // The agent outlives the content tree, so it is not the cleanContent fixture's to take.
      await request.delete(`/api/v1/agents/${agent.id}`);
    }
  });
});
