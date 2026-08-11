import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Comments on a database column, driven through the real UI. A column thread lives in the same
 * panel as every other thread, so this spec walks the whole life of one: write, reload, reply,
 * resolve. The last test proves a deleted column takes its thread with it.
 */

function grid(page: Page): Locator {
  return page.getByTestId('db-table');
}

function panel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Comments' });
}

/** The toolbar button that opens the panel. Its label carries the unresolved count. */
function commentsButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Comments, \d+ open$/ });
}

/** The comment badge on a column header. Its label carries the count of open threads. */
function badge(page: Page, column: string): Locator {
  return grid(page).getByRole('button', { name: new RegExp(`^Comments on ${column}, `) });
}

/** Open the menu of one column header. It hangs off the body, so it is looked up on the page. */
async function columnMenu(page: Page, column: string): Promise<Locator> {
  await grid(page)
    .getByRole('button', { name: new RegExp(`^${column}`) })
    .click();
  return page.getByRole('menu', { name: `${column} column` });
}

/** Write the first remark on a column and wait for the panel to hold it. */
async function commentOnColumn(page: Page, column: string, body: string): Promise<void> {
  const menu = await columnMenu(page, column);
  await menu.getByRole('menuitem', { name: 'Comment on this column' }).click();
  await expect(panel(page).getByText(`Column: ${column}`)).toBeVisible();
  await panel(page).getByLabel('Write a comment').fill(body);
  await panel(page).getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(panel(page).getByText(body)).toBeVisible();
}

test.describe('comments on a database column', () => {
  let path = '';

  test.beforeEach(async ({ api }) => {
    const space = await api.createUniqueSpace('dbcomments');
    path = `${space.slug}/tasks`;
    const created = await api.createPage({
      path,
      title: 'Tasks',
      markdown: 'The plan lives below.\n',
    });
    await api.makeDatabase(created.id);
  });

  test('takes a comment on a column, keeps it over a reload, then replies and resolves', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await expect(grid(page)).toBeVisible();

    await commentOnColumn(page, 'Status', 'Should this be a select?');
    await expect(badge(page, 'Status')).toHaveAttribute(
      'aria-label',
      'Comments on Status, 1 open',
    );

    // A reload leaves the panel closed, so the badge is what proves the thread survived.
    await page.reload();
    await expect(grid(page)).toBeVisible();
    await expect(badge(page, 'Status')).toHaveAttribute(
      'aria-label',
      'Comments on Status, 1 open',
    );
    await expect(panel(page)).toHaveCount(0);

    // A click on the badge opens the one comment surface on that thread.
    await badge(page, 'Status').click();
    const thread = panel(page).locator('[data-thread-id]');
    await expect(thread.getByText('Should this be a select?')).toBeVisible();
    await expect(panel(page).getByText('Column: Status')).toBeVisible();
    await expect(panel(page).locator('.comments__thread--active')).toHaveCount(1);

    await thread.getByRole('button', { name: 'Reply' }).click();
    await panel(page).getByLabel('Reply').fill('Three states are enough.');
    await panel(page).getByRole('button', { name: 'Reply' }).click();
    await expect(panel(page).getByText('Three states are enough.')).toBeVisible();
    await expect(panel(page).locator('.comment')).toHaveCount(2);

    await thread.getByRole('button', { name: 'Resolve' }).click();
    await expect(panel(page).locator('[data-thread-id]')).toHaveCount(0);
    await expect(panel(page).locator('.comments__count')).toHaveText('0 open');
    await expect(badge(page, 'Status')).toHaveAttribute(
      'aria-label',
      'Comments on Status, 0 open',
    );

    // The talk about the column never reaches the file the column itself is written in.
    const raw = (await content.pageFileText(path)) ?? '';
    expect(raw).toContain('name: Status');
    expect(raw).not.toContain('Should this be a select?');
  });

  test('renames the column and keeps the thread, because the thread names the property id', async ({
    page,
  }) => {
    await page.goto(`/p/${path}`);
    await expect(grid(page)).toBeVisible();

    await commentOnColumn(page, 'Status', 'Should this be a select?');

    const menu = await columnMenu(page, 'Status');
    await menu.getByLabel('Property name').fill('State');
    await menu.getByLabel('Property name').press('Enter');
    await expect(grid(page).getByRole('button', { name: /^State/ })).toBeVisible();

    await expect(badge(page, 'State')).toHaveAttribute('aria-label', 'Comments on State, 1 open');
    await badge(page, 'State').click();
    await expect(panel(page).getByText('Column: State')).toBeVisible();
    await expect(panel(page).getByText('Should this be a select?')).toBeVisible();
  });

  test('drops the thread with the column it is about', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await expect(grid(page)).toBeVisible();

    await commentOnColumn(page, 'Notes', 'Do we still need this column?');
    await expect(badge(page, 'Notes')).toBeVisible();

    const menu = await columnMenu(page, 'Notes');
    await menu.getByRole('menuitem', { name: 'Delete property' }).click();
    await expect(grid(page).getByRole('button', { name: /^Notes/ })).toHaveCount(0);

    // Nothing is left to reopen: not on this render, and not after a reload.
    await expect(commentsButton(page)).toHaveAttribute('aria-label', 'Comments, 0 open');
    await page.reload();
    await expect(grid(page)).toBeVisible();
    await commentsButton(page).click();
    await expect(panel(page).locator('[data-thread-id]')).toHaveCount(0);

    // A resolved thread is hidden, and the panel offers to show it. The offer never comes, so
    // the thread was dropped rather than tucked away.
    await expect(panel(page).getByRole('checkbox')).toHaveCount(0);
    await expect(panel(page).getByText('No comments yet.', { exact: false })).toBeVisible();
  });
});
