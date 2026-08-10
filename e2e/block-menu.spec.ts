import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient } from './fixtures';

/**
 * The menu the grip on the left opens. It names one block and offers the two things that
 * cannot be typed: a comment on the whole line, and a delete of the block.
 */

const FIRST = 'Run the pipeline every Friday.';
const SECOND = 'The old plan ran it on Monday.';
const BODY = `${FIRST}\n\n${SECOND}\n`;

function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

function panel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Comments' });
}

/** Bring the handles up beside a paragraph and open the menu on it. */
async function openMenu(page: Page, text: string): Promise<Locator> {
  await editorBody(page).locator('p', { hasText: text }).hover();
  const grip = page.getByRole('button', { name: 'Block actions' });
  await expect(grip).toBeVisible();
  await grip.click();
  const menu = page.getByRole('menu', { name: 'Block actions' });
  await expect(menu).toBeVisible();
  return menu;
}

async function seedPage(api: ApiClient, name: string): Promise<{ path: string; href: string }> {
  const space = await api.createUniqueSpace('blockmenu');
  const path = `${space.slug}/${name}`;
  await api.createPage({ path, title: name, markdown: BODY });
  return { path, href: `/p/${path}` };
}

test.describe('block handle menu', () => {
  test('deletes the block it was opened on, down to the file', async ({ page, api, content }) => {
    const seeded = await seedPage(api, 'trim');

    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(SECOND);

    await (await openMenu(page, FIRST)).getByRole('menuitem', { name: 'Delete' }).click();

    await expect(editorBody(page)).not.toContainText(FIRST);
    await expect(editorBody(page)).toContainText(SECOND);
    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .not.toContain(FIRST);
  });

  test('comments on the whole line, not on a word of it', async ({ page, api }) => {
    const seeded = await seedPage(api, 'whole-line');

    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(SECOND);

    await (await openMenu(page, SECOND)).getByRole('menuitem', { name: 'Comment' }).click();

    await panel(page).getByLabel('Write a comment').fill('Is Monday still right?');
    await panel(page).getByRole('button', { name: 'Comment', exact: true }).click();

    await expect(panel(page).getByText('Is Monday still right?')).toBeVisible();
    // The quote is the whole line, which is what "comment on the line" has to mean.
    await expect(panel(page).locator('q.comments__quote-text')).toHaveText(SECOND);
    await expect(editorBody(page).locator('.gd-comment')).toHaveText(SECOND);
  });
});
