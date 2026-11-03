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

/** ProseMirror's own click run is 500ms wide. Anything longer starts a fresh count. */
const CLICK_RUN_MS = 600;

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

  // ProseMirror counts clicks itself, over 500ms and 10px, and a click in the comment panel
  // never reaches it to break the run. Two selections of the same word in a row would land as
  // a triple click and take the whole paragraph, so the run is left to lapse first.
  await page.waitForTimeout(CLICK_RUN_MS);
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
    // The card leaves the list on the spot. It used to stay, greyed out, until a reload.
    await expect(panel(page).locator('[data-thread-id]')).toHaveCount(0);
    await expect(panel(page).locator('.comments__count')).toHaveText('0 open');
    await expect(commentsButton(page)).toHaveAttribute('aria-label', 'Comments, 0 open');

    // Resolved is hidden, not gone: it comes back on request, replies and all.
    await page.reload();
    await commentsButton(page).click();
    await expect(panel(page).locator('[data-thread-id]')).toHaveCount(0);
    await panel(page).getByRole('checkbox').check();
    // A card nobody is in shows only the first remark, so the reply needs a click to read.
    await panel(page).locator('[data-thread-id]').click();
    await expect(panel(page).getByText('It is. I checked it on Monday.')).toBeVisible();

    await panel(page).getByRole('button', { name: 'Reopen' }).click();
    await expect(panel(page).locator('.comments__count')).toHaveText('1 open');
  });

  test('names somebody from the menu the @ opens, and draws the chip', async ({ page, api }) => {
    const seeded = await seedPage(api, 'mention', BODY);

    await open(page, seeded.href);
    await commentsButton(page).click();
    await panel(page).getByRole('button', { name: 'Comment on the page' }).click();

    const field = panel(page).getByLabel('Write a comment');
    await field.fill('over to @e2e');
    const menu = panel(page).getByRole('listbox', { name: 'Mention somebody' });
    await expect(menu).toBeVisible();
    await menu.getByRole('option', { name: /E2E Admin/ }).click();

    // The whole handle lands in the field, not the fragment that was typed.
    await expect(field).toHaveValue('over to @e2e.admin ');
    await expect(menu).toHaveCount(0);

    await panel(page).getByRole('button', { name: 'Comment', exact: true }).click();

    const chip = panel(page).locator('.comment__mention');
    await expect(chip).toHaveText('@e2e.admin');
    // The admin is reading their own page, so the chip is the one that marks the reader.
    await expect(chip).toHaveClass(/comment__mention--me/);
  });

  test('scrolls the page and its comments as one canvas', async ({ page, api }) => {
    const long = `${LINE}\n\n${'A line of the plan.\n\n'.repeat(120)}`;
    const seeded = await seedPage(api, 'canvas', long);

    // The page is longer than the viewport, so `open` cannot assert the whole body here.
    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(LINE);
    await selectWord(page, LINE, 'pipeline');
    await comment(page, 'Still Friday?');

    // One scroller for the whole canvas: the page area no longer keeps a scrollbar of its own.
    const layout = await page.evaluate(() => {
      const content = document.querySelector('.app-content');
      const body = document.querySelector('.app-body');
      return {
        content: content === null ? '' : getComputedStyle(content).overflowY,
        bodyScrolls: body !== null && body.scrollHeight > body.clientHeight + 1,
      };
    });
    expect(layout.content).toBe('visible');
    expect(layout.bodyScrolls).toBe(true);

    const before = await panel(page).boundingBox();
    await page.evaluate(() => document.querySelector('.app-body')?.scrollBy(0, 600));
    const after = await panel(page).boundingBox();
    if (before === null || after === null) throw new Error('The panel has no layout');
    expect(after.y).toBeLessThan(before.y - 100);
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

  test('shows the first remark of a card until somebody clicks into it', async ({ page, api }) => {
    const seeded = await seedPage(api, 'peek', BODY);

    await open(page, seeded.href);
    await selectWord(page, LINE, 'pipeline');
    await comment(page, 'Is this still the right pipeline?');

    const card = panel(page).locator('[data-thread-id]');
    await card.getByRole('button', { name: 'Reply' }).click();
    await panel(page).getByLabel('Reply').fill('It is. I checked it on Monday.');
    await panel(page).getByRole('button', { name: 'Reply' }).click();
    await expect(panel(page).getByText('It is. I checked it on Monday.')).toBeVisible();

    // Nothing is in focus after a reload, so every card is closed.
    await page.reload();
    await commentsButton(page).click();
    await expect(panel(page).getByText('Is this still the right pipeline?')).toBeVisible();
    await expect(panel(page).getByText('It is. I checked it on Monday.')).toBeHidden();
    await expect(panel(page).getByText('1 more reply')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Reply' })).toHaveCount(0);

    await card.click();

    await expect(panel(page).getByText('It is. I checked it on Monday.')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Reply' })).toBeVisible();
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

/** A line far enough down the page that a card at the top of the panel is nowhere near it. */
const DOWN = 'The deadline moved to the end of the quarter.';
const SPACED = 'Nobody owns the runbook yet.';
const FILLER = 'A line of the plan.';
const PAGE_BODY = `${LINE}\n\n${`${FILLER}\n\n`.repeat(12)}${DOWN}\n\n${`${FILLER}\n\n`.repeat(2)}${SPACED}\n`;

/** The top of a box on the screen, which is what "beside the text" is measured in. */
async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element has no layout');
  return box.y;
}

/** Every thread card on the screen, top to bottom, as plain boxes. */
async function cardBoxes(page: Page): Promise<Array<{ top: number; bottom: number }>> {
  const boxes = await panel(page)
    .locator('[data-thread-id]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }),
    );
  return boxes.sort((a, b) => a.top - b.top);
}

/**
 * Write a thread straight into the store. Each quote below is on the page exactly once, so the
 * words alone find it and the test does not have to select anything with the pointer.
 */
async function seedThread(
  request: APIRequestContext,
  pageId: string,
  quote: string,
  body: string,
): Promise<void> {
  const made = await request.post(`/api/v1/pages/${pageId}/comments`, {
    data: { body, anchor: { quote, prefix: '', suffix: '', start: 0 } },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
}

test.describe('comments beside the text', () => {
  test('stands a card level with the words it marks', async ({ page, api, request }) => {
    const seeded = await seedPage(api, 'level', PAGE_BODY);
    await seedThread(request, seeded.id, 'deadline', 'Which quarter is this?');

    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(DOWN);
    await commentsButton(page).click();

    const card = panel(page).locator('[data-thread-id]');
    await expect(card).toHaveCount(1);
    const mark = highlight(page, 'deadline');

    // The card does not sit at the top of the panel: it is beside its own line. A card that has
    // just been placed is still on its way there, so the distance is polled rather than read once.
    await expect
      .poll(async () => Math.abs((await topOf(card)) - (await topOf(mark))))
      .toBeLessThan(40);
  });

  test('reads two threads about one line as a single group', async ({ page, api, request }) => {
    const seeded = await seedPage(api, 'grouped', PAGE_BODY);
    await seedThread(request, seeded.id, 'deadline', 'Which quarter is this?');
    await seedThread(request, seeded.id, 'quarter', 'The fourth one, I hope.');

    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(DOWN);
    await commentsButton(page).click();

    const group = panel(page).locator('.comments__group--many');
    await expect(group).toHaveCount(1);
    await expect(group.locator('[data-thread-id]')).toHaveCount(2);
  });

  test('moves two cards apart rather than let one cover the other', async ({
    page,
    api,
    request,
  }) => {
    const seeded = await seedPage(api, 'apart', PAGE_BODY);
    await seedThread(request, seeded.id, 'deadline', 'Which quarter is this?');
    await seedThread(request, seeded.id, 'runbook', 'I will take it.');

    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(SPACED);
    await commentsButton(page).click();

    // Two spots on the page, so two groups, and the cards are too tall to both fit at their words.
    await expect(panel(page).locator('.comments__group')).toHaveCount(2);
    await expect(panel(page).locator('.comments__group--many')).toHaveCount(0);

    // The room between the two cards, once they have both arrived where they belong.
    const between = async (): Promise<number> => {
      const boxes = await cardBoxes(page);
      if (boxes.length !== 2) return -1;
      return (boxes[1]?.top ?? 0) - (boxes[0]?.bottom ?? 0);
    };
    await expect.poll(between).toBeGreaterThanOrEqual(0);
  });
});
