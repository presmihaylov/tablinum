import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test, uniqueSlug, BASE_URL } from './fixtures';

/**
 * An agent takes part in the review the way a person does.
 *
 * It quotes the words a reader sees, opens a thread on them, answers the thread a person opened
 * and closes it again. Every step goes through the remote MCP endpoint, so the whole path is
 * real, and the reader's panel is what proves it: the card carries the agent's own name.
 */

const MARKDOWN = '# Release\n\nRun the pipeline from main.\n';
const LINE = 'Run the pipeline from main.';

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

/** The same call, but the tool is expected to refuse it. */
async function callToolFailing(
  agent: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await agent.post('/api/v1/mcp', {
    headers: MCP_HEADERS,
    data: { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } },
  });
  const body = (await response.json()) as ToolResult;
  const text = (body.result?.content ?? []).map((part) => part.text ?? '').join('\n');
  expect(body.result?.isError ?? false, text).toBe(true);
  return text;
}

function panel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Comments' });
}

function cardFor(page: Page, threadId: string): Locator {
  return panel(page).locator(`[data-thread-id="${threadId}"]`);
}

/** The thread ids on a page, newest last, read as the signed-in person. */
async function threadIds(request: APIRequestContext, pageId: string): Promise<string[]> {
  const response = await request.get(`/api/v1/pages/${pageId}/comments`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { threads: Array<{ id: string }> };
  return body.threads.map((thread) => thread.id);
}

test.describe('an agent commenting on a page', () => {
  test('quotes a heading, answers a person and closes the thread', async ({
    page,
    api,
    request,
    playwright,
  }) => {
    const name = `Reviewer ${uniqueSlug('a')}`;
    const made = await request.post('/api/v1/agents', {
      data: { name, identity: 'You review the release notes.' },
    });
    expect(made.ok(), await made.text()).toBeTruthy();
    const { agent, token } = (await made.json()) as { agent: { id: string }; token: string };

    const space = await api.createUniqueSpace('agent-comment');
    const path = `${space.slug}/release`;
    const created = await api.createPage({ path, title: 'Release', markdown: MARKDOWN });

    const asAgent = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { authorization: `Bearer ${token}` },
    });

    try {
      // A reader has the page open, with the comment panel showing, before anything is written.
      await page.goto(`/p/${path}`);
      await expect(page.locator('.gd-editor-surface')).toContainText(LINE);
      await page.getByRole('button', { name: /^Comments, \d+ open$/ }).click();
      await expect(panel(page)).toBeVisible();

      // A quote of the markdown finds nothing: a thread is about the words a reader sees.
      const refused = await callToolFailing(asAgent, 'tablinum_comment', {
        path,
        body: 'Which release?',
        quote: '# Release',
      });
      expect(refused).toContain('as a reader sees it');

      // The same words without the marker land on the heading.
      const left = await callTool(asAgent, 'tablinum_comment', {
        path,
        body: 'Which release is this? Please name the version.',
        quote: 'Release',
      });
      expect(left).toContain('Left a comment on');
      expect(left).toContain('the markdown file did not change');

      // The reader sees the card, under the agent's own name, without reloading.
      const [threadId] = await threadIds(request, created.id);
      expect(threadId).toBeDefined();
      const card = cardFor(page, threadId ?? '');
      await expect(card).toContainText(name);
      await expect(card).toContainText('Which release is this?');
      await expect(panel(page).locator('q.comments__quote-text')).toHaveText('Release');

      // The reader answers it in the panel.
      await card.click();
      await card.getByRole('button', { name: 'Reply' }).click();
      await panel(page).getByLabel('Reply').fill('Version 4.2, out on Friday.');
      await panel(page).getByRole('button', { name: 'Reply' }).click();
      await expect(card).toContainText('Version 4.2, out on Friday.');

      // The agent reads the answer back, with both names spelled out.
      const listed = await callTool(asAgent, 'tablinum_list_comments', { path, open: true });
      expect(listed).toContain('Version 4.2, out on Friday.');
      expect(listed).toContain(name);
      expect(listed).not.toContain('a former member');

      // It answers, then closes the thread.
      await callTool(asAgent, 'tablinum_reply', {
        thread: threadId,
        body: 'Thank you. I put the version in the heading.',
      });
      await expect(card).toContainText('I put the version in the heading.');

      const closed = await callTool(asAgent, 'tablinum_resolve_comment', { thread: threadId });
      expect(closed).toContain('Resolved a comment on');
      await expect(panel(page).locator('.comments__count')).toHaveText('0 open');

      // A comment is never part of the page, so the words are exactly the seeded ones. The
      // trailing blank line is the editor's to keep or drop, and it means nothing here.
      const after = await api.getPage(path);
      expect(after?.markdown.trim()).toBe(MARKDOWN.trim());
    } finally {
      await asAgent.dispose();
      // The agent outlives the content tree, so it is not the cleanContent fixture's to take.
      await request.delete(`/api/v1/agents/${agent.id}`);
    }
  });
});
