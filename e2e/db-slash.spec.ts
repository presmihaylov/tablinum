import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ContentRepo } from './fixtures';

/**
 * The three database commands of the slash menu, driven through the real UI. Each one makes a
 * child page and turns it into a database; what differs is where the result is drawn.
 */

function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

/** The database drawn inside the body of the open page, not the one below it. */
function embeddedDb(page: Page): Locator {
  return page.locator('.gd-editor-pageembed__db');
}

/** The stored markdown of a page, once its file exists on disk. */
async function fileText(content: ContentRepo, pagePath: string): Promise<string> {
  const file = await content.waitForPageFile(pagePath);
  return (await content.read(file)) ?? '';
}

/** Wait until the stored markdown of a page holds `needle`. Every save is debounced. */
async function expectFileToContain(
  content: ContentRepo,
  pagePath: string,
  needle: string,
): Promise<void> {
  await expect
    .poll(async () => (await content.pageFileText(pagePath)) ?? '')
    .toContain(needle);
}

/** Open the slash menu at the cursor and take the option whose title reads `title`. */
async function runCommand(page: Page, query: string, title: string): Promise<void> {
  await editorBody(page).click();
  await page.keyboard.press('End');
  // The menu only opens after a space or at the start of a line, so a command needs its own line.
  await page.keyboard.press('Enter');
  await page.keyboard.type(`/${query}`);
  const menu = page.getByRole('listbox', { name: 'Insert block' });
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: title }).first().click();
}

test.describe('database slash commands', () => {
  let slug = '';
  let path = '';

  test.beforeEach(async ({ api }) => {
    slug = (await api.createUniqueSpace('dbslash')).slug;
    path = `${slug}/plan`;
    await api.createPage({ path, title: 'Plan', markdown: 'The work lives below.\n' });
  });

  test('draws a database in the body of the page', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await expect(editorBody(page)).toContainText('The work lives below.');

    await runCommand(page, 'inline', 'Database - Inline');

    // The grid itself, drawn in place, not a link to another page.
    await expect(embeddedDb(page).getByRole('region', { name: 'Database' })).toBeVisible();
    await expect(embeddedDb(page).getByTestId('db-table')).toBeVisible();

    // The embed is one line of markdown, and the schema lives on the child page.
    await expectFileToContain(content, path, `![[${path}/database]]`);
    const child = await fileText(content, `${path}/database`);
    expect(child).toContain('db:');
    expect(child).toContain('type: table');
  });

  test('makes a page that is nothing but the database, and opens it', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await expect(editorBody(page)).toContainText('The work lives below.');

    await runCommand(page, 'database', 'Database - Page');

    await expect(page).toHaveURL(new RegExp(`/p/${path}/database$`));
    await expect(page.getByRole('region', { name: 'Database' })).toBeVisible();
    // Nothing is embedded: the parent only links to it.
    await expect(embeddedDb(page)).toHaveCount(0);

    await expectFileToContain(content, path, `[[${path}/database]]`);
    expect(await fileText(content, path)).not.toContain(`![[${path}/database]]`);
  });

  test('draws a board from the first moment', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await expect(editorBody(page)).toContainText('The work lives below.');

    await runCommand(page, 'board', 'Board view');

    await expect(embeddedDb(page).getByTestId('db-board')).toBeVisible();
    await expect(embeddedDb(page).getByTestId('db-table')).toHaveCount(0);

    const child = await fileText(content, `${path}/board`);
    expect(child).toContain('type: board');
    expect(child).toContain('groupBy:');
  });

  test('keeps the database close under the body of a database page', async ({ page, api }) => {
    const dbPath = `${slug}/tasks`;
    const created = await api.createPage({ path: dbPath, title: 'Tasks', markdown: 'Notes.\n' });
    await api.makeDatabase(created.id);
    await page.goto(`/p/${dbPath}`);

    const grid = page.getByRole('region', { name: 'Database' });
    await expect(grid).toBeVisible();

    // The empty body used to claim half the viewport, which pushed the grid off the screen.
    const bodyBox = await editorBody(page).boundingBox();
    const gridBox = await grid.boundingBox();
    if (bodyBox === null || gridBox === null) throw new Error('The page has no layout');
    expect(gridBox.y - (bodyBox.y + bodyBox.height)).toBeLessThan(80);
  });
});
