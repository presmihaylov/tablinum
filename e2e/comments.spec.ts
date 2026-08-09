import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient } from './fixtures';

/**
 * Comments, driven through the real UI. It mirrors apps/web/test/comments.test.tsx: what the
 * unit tests prove over a mocked server, this spec proves over the running one, down to the
 * file on disk that must never learn a comment exists.
 */

const LINE = 'Run the pipeline every Friday.';
const BODY = `${LINE}\n`;

/** ProseMirror's editable box is a plain `div`, so the class is the handle the unit tests use. */
function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

function panel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Comments' });
}

/** The toolbar button that opens the panel. Its label carries the unresolved count. */
function commentsButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Comments, \d+ open$/ });
}

/** One highlighted range in the document, found by the words it sits on. */
function highlight(page: Page, text: string): Locator {
  return editorBody(page).locator('.gd-comment', { hasText: text });
}

async function seedPage(
  api: ApiClient,
  name: string,
  markdown: string,
): Promise<{ id: string; path: string; href: string }> {
  const space = await api.createUniqueSpace('comments');
  const path = `${space.slug}/${name}`;
  const created = await api.createPage({ path, title: name, markdown });
  return { id: created.id, path, href: `/p/${path}` };
}

/**
 * Select `word` with a double click on the middle of it. A keyboard selection moves the DOM
 * selection without focusing ProseMirror, and then the toolbar never appears; a real pointer
 * is what a reader uses anyway. The word is measured in the page, so the click cannot drift.
 */
async function selectWord(page: Page, line: string, word: string): Promise<void> {
  if (!line.includes(word)) throw new Error(`${word} is not in ${line}`);

  const spot = await editorBody(page).evaluate((surface, wanted) => {
    const walk = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node !== null; node = walk.nextNode()) {
      const at = (node.textContent ?? '').indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return null;
  }, word);
  if (spot === null) throw new Error(`${word} is not on the page`);

  await page.mouse.dblclick(spot.x, spot.y);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe(word);
}

/** Write a new thread on whatever is selected, and wait for the panel to hold it. */
async function comment(page: Page, body: string): Promise<void> {
  await page
    .getByRole('toolbar', { name: 'Text formatting' })
    .getByRole('button', { name: 'Comment' })
    .click();
  await panel(page).getByLabel('Write a comment').fill(body);
  await panel(page).getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(panel(page).getByText(body)).toBeVisible();
}

/** The page, opened and loaded, with the editor showing the markdown it was seeded with. */
async function open(page: Page, href: string): Promise<void> {
  await page.goto(href);
  await expect(editorBody(page)).toHaveText(LINE);
}

async function threadIds(request: APIRequestContext, pageId: string): Promise<string[]> {
  const response = await request.get(`/api/v1/pages/${pageId}/comments`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { threads: Array<{ id: string }> };
  return body.threads.map((thread) => thread.id);
}

/** The markdown under the frontmatter block. The block itself is the server's, not the editor's. */
function markdownOf(text: string): string {
  const match = /^---\n[\s\S]*?\n---\n\n?/.exec(text);
  if (match === null) throw new Error('the page file carries no frontmatter block');
  return text.slice(match[0].length);
}

test.describe('comments', () => {
  test('anchors a comment to the selected text and keeps it over a reload', async ({ page, api }) => {
    const seeded = await seedPage(api, 'anchored', BODY);

    await open(page, seeded.href);
    await selectWord(page, LINE, 'pipeline');
    await comment(page, 'Is this still the right pipeline?');

    // The words the thread was written about are highlighted, and the count says one is open.
    await expect(highlight(page, 'pipeline')).toBeVisible();
    await expect(panel(page).locator('.comments__count')).toHaveText('1 open');
    await expect(panel(page).locator('q.comments__quote-text')).toHaveText('pipeline');

    // A reload leaves the panel closed, so the highlight is what proves the thread survived.
    await page.reload();
    await expect(highlight(page, 'pipeline')).toBeVisible();
    await expect(commentsButton(page)).toHaveAttribute('aria-label', 'Comments, 1 open');
    await expect(panel(page)).toHaveCount(0);

    // A click on the highlight opens the panel on that thread: the link runs both ways.
    await highlight(page, 'pipeline').click();
    await expect(panel(page).getByText('Is this still the right pipeline?')).toBeVisible();
    await expect(panel(page).locator('.comments__thread--active')).toHaveCount(1);
    await expect(highlight(page, 'pipeline')).toHaveClass(/gd-comment--active/);
  });

  test('takes a reply, then hides the thread once it is resolved', async ({ page, api }) => {
    const seeded = await seedPage(api, 'resolved', BODY);

    await open(page, seeded.href);
    await selectWord(page, LINE, 'pipeline');
    await comment(page, 'Is this still the right pipeline?');

    const thread = panel(page).locator('[data-thread-id]');
    await thread.getByRole('button', { name: 'Reply' }).click();
    await panel(page).getByLabel('Reply').fill('It is. I checked it on Monday.');
    await panel(page).getByRole('button', { name: 'Reply' }).click();
    await expect(panel(page).getByText('It is. I checked it on Monday.')).toBeVisible();
    await expect(panel(page).locator('.comment')).toHaveCount(2);

    await thread.getByRole('button', { name: 'Resolve' }).click();
    await expect(panel(page).locator('.comments__count')).toHaveText('0 open');
    await expect(commentsButton(page)).toHaveAttribute('aria-label', 'Comments, 0 open');

    // Resolved is hidden, not gone: it comes back on request, replies and all.
    await page.reload();
    await commentsButton(page).click();
    await expect(panel(page).locator('[data-thread-id]')).toHaveCount(0);
    await panel(page).getByRole('checkbox').check();
    await expect(panel(page).getByText('It is. I checked it on Monday.')).toBeVisible();

    await panel(page).getByRole('button', { name: 'Reopen' }).click();
    await expect(panel(page).locator('.comments__count')).toHaveText('1 open');
  });

  test('shows a comment written in one tab in another tab without a reload', async ({ page, api }) => {
    const seeded = await seedPage(api, 'live', BODY);
    const other = await page.context().newPage();

    await open(page, seeded.href);
    await open(other, seeded.href);
    await commentsButton(other).click();
    await expect(panel(other).locator('[data-thread-id]')).toHaveCount(0);

    await selectWord(page, LINE, 'pipeline');
    await comment(page, 'Written in the first tab.');

    await expect(panel(other).getByText('Written in the first tab.')).toBeVisible();
    await expect(highlight(other, 'pipeline')).toBeVisible();
    await other.close();
  });

  test('keeps an orphaned thread readable when its text is edited away', async ({ page, api }) => {
    const seeded = await seedPage(api, 'orphaned', BODY);

    await open(page, seeded.href);
    await selectWord(page, LINE, 'pipeline');
    await comment(page, 'Which pipeline is this?');
    await expect(highlight(page, 'pipeline')).toBeVisible();

    // The anchored word goes away, so nothing in the document matches the quote any more.
    await selectWord(page, LINE, 'pipeline');
    await page.keyboard.type('rollout');
    await expect(editorBody(page)).toHaveText('Run the rollout every Friday.');

    // No fuzzy match is tried: the thread says so, and it keeps the words it was written about.
    await expect(panel(page).getByText('This text is no longer on the page.')).toBeVisible();
    await expect(panel(page).locator('q.comments__quote-text')).toHaveText('pipeline');
    await expect(panel(page).getByText('Which pipeline is this?')).toBeVisible();
    await expect(editorBody(page).locator('.gd-comment')).toHaveCount(0);
  });

  test('writes nothing about a comment into the markdown file', async ({ page, api, content }) => {
    const seeded = await seedPage(api, 'untouched', BODY);
    const file = await content.waitForPageFile(seeded.path);
    const before = await content.read(file);

    await open(page, seeded.href);
    await selectWord(page, LINE, 'pipeline');
    await comment(page, 'A remark that belongs in the database, not in the file.');
    await expect(highlight(page, 'pipeline')).toBeVisible();

    const after = (await content.read(file)) ?? '';
    expect(markdownOf(after)).toBe(BODY);
    expect(after).toBe(before);
    expect(after).not.toContain('ct_');
    expect(after).not.toContain('gd-comment');
    expect(after).not.toContain('A remark that belongs');
    // A page nobody edited must leave nothing for git to commit.
    await content.waitForCleanTree();
  });

  test('turns a caller with no session away from both reading and writing', async ({
    page,
    api,
    request,
    signedOutRequest,
  }) => {
    const seeded = await seedPage(api, 'guarded', BODY);

    await open(page, seeded.href);
    await selectWord(page, LINE, 'pipeline');
    await comment(page, 'Only a signed-in person may write this.');
    expect(await threadIds(request, seeded.id)).toHaveLength(1);

    const read = await signedOutRequest.get(`/api/v1/pages/${seeded.id}/comments`);
    expect(read.status()).toBe(401);

    const written = await signedOutRequest.post(`/api/v1/pages/${seeded.id}/comments`, {
      data: { body: 'From nobody at all.' },
    });
    expect(written.status()).toBe(401);
  });
});
