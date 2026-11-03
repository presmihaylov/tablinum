import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The database on the open page: its tools and its body. */
function db(page: Page): Locator {
  return page.getByRole('region', { name: 'Database' });
}

function board(page: Page): Locator {
  return page.getByTestId('db-board');
}

/** One stack of the board, by the name in its header. */
function column(page: Page, name: string): Locator {
  return board(page).locator('.db-board__col', { has: page.getByText(name, { exact: true }) });
}

/** The card of one row. */
function card(page: Page, title: string): Locator {
  return board(page).locator('.db-card').filter({ hasText: title });
}

/** Wait for the grid of the database the page was seeded with. */
async function openDatabase(page: Page): Promise<void> {
  await expect(page.getByTestId('db-table')).toBeVisible();
}

/** Add a row from the table and wait for it to arrive under the title it was given. */
async function addRow(page: Page, title: string): Promise<void> {
  const titles = page.getByTestId('db-table').getByLabel('Row title');
  const before = await titles.count();
  await db(page).getByRole('button', { name: 'New', exact: true }).first().click();
  await expect(titles).toHaveCount(before + 1);

  const untitled = titles.nth(before);
  await untitled.fill(title);
  await untitled.press('Enter');
  await expect(untitled).toHaveValue(title);
}

/** Add an option to the Status column through the cell of one row. */
async function addStatus(page: Page, rowIndex: number, name: string): Promise<void> {
  const row = page.getByTestId('db-table').locator('tbody tr').nth(rowIndex);
  await row.getByLabel('Status').click();
  await page.getByLabel('Search Status options').fill(name);
  await page.getByRole('menuitem', { name: /Create/ }).click();
  await expect(row.getByText(name)).toBeVisible();
}

/** Switch the open view to a board. */
async function turnIntoBoard(page: Page): Promise<void> {
  await page.getByRole('tab', { selected: true }).click();
  await page.getByLabel('View layout').selectOption('board');
  await expect(board(page)).toBeVisible();
  // The view menu stays open, and the next click on the tab would only close it again.
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('View layout')).toHaveCount(0);
}

/** The row titles the page file holds, in the order it holds them. */
function rowTitles(text: string | null): string[] {
  return [...(text ?? '').matchAll(/^ {4}title: (.+)$/gm)].map((match) => match[1] ?? '');
}

/**
 * Drag one element onto another. `dragTo` moves the mouse once, and Chromium needs several
 * moves before it raises a native drag at all.
 */
async function drag(from: Locator, to: Locator, where: 'middle' | 'top' = 'middle'): Promise<void> {
  const page = from.page();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (start === null || end === null) throw new Error('A dragged element has no box');

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  const target = {
    x: end.x + end.width / 2,
    y: where === 'top' ? end.y + 3 : end.y + end.height / 2,
  };
  for (let step = 1; step <= 6; step += 1) {
    const ratio = step / 6;
    await page.mouse.move(
      start.x + start.width / 2 + (target.x - start.x - start.width / 2) * ratio,
      start.y + start.height / 2 + (target.y - start.y - start.height / 2) * ratio,
    );
  }
  await page.mouse.up();
}

test.describe('kanban boards', () => {
  let slug = '';
  let path = '';

  test.beforeEach(async ({ api }) => {
    slug = (await api.createUniqueSpace('kb')).slug;
    path = `${slug}/tasks`;
    const created = await api.createPage({
      path,
      title: 'Tasks',
      markdown: 'The plan lives below.\n',
    });
    await api.makeDatabase(created.id);
  });

  test('turns a table view into a board and writes the layout to the page file', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await turnIntoBoard(page);

    const file = await content.waitForPageFile(path);
    await expect.poll(async () => (await content.read(file)) ?? '').toContain('type: board');
    expect((await content.read(file)) ?? '').toContain('groupBy: pr_');
  });

  test('stacks the cards by the option each row holds', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addRow(page, 'Write it');
    await addStatus(page, 0, 'Doing');
    await turnIntoBoard(page);

    await expect(column(page, 'Doing').locator('.db-card')).toHaveCount(1);
    await expect(column(page, 'Doing')).toContainText('Ship it');
    await expect(column(page, 'No Status')).toContainText('Write it');
  });

  test('moves a card to another stack by dragging it', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addStatus(page, 0, 'Doing');
    await addRow(page, 'Write it');
    await turnIntoBoard(page);

    await drag(card(page, 'Write it'), column(page, 'Doing'));

    await expect(column(page, 'Doing').locator('.db-card')).toHaveCount(2);
    await expect(column(page, 'No Status').locator('.db-card')).toHaveCount(0);

    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '', {
        message: 'the move never reached the database page',
      })
      .toContain('Doing');
  });

  test('moves a card up its own stack and keeps the order in the page file', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Alpha');
    await addRow(page, 'Bravo');
    await addRow(page, 'Charlie');
    await turnIntoBoard(page);

    const stack = column(page, 'No Status');
    await expect(stack.locator('.db-card')).toHaveCount(3);

    await drag(card(page, 'Charlie'), card(page, 'Alpha'), 'top');

    await expect(stack.locator('.db-card')).toHaveText([/Charlie/, /Alpha/, /Bravo/]);
    await expect
      .poll(async () => rowTitles(await content.pageFileText(path)), {
        message: 'the new order never reached the database page',
      })
      .toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  test('leaves a card where it is when it lands where it already was', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Alpha');
    await addRow(page, 'Bravo');
    await turnIntoBoard(page);

    await drag(card(page, 'Alpha'), card(page, 'Bravo'), 'top');

    await expect(column(page, 'No Status').locator('.db-card')).toHaveText([/Alpha/, /Bravo/]);
    expect(rowTitles(await content.pageFileText(path))).toEqual(['Alpha', 'Bravo']);
  });

  test('adds a stack to the board', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await turnIntoBoard(page);

    await board(page).getByRole('button', { name: 'Add a stack' }).click();
    const name = page.getByLabel('New stack name');
    await name.fill('In review');
    await name.press('Enter');

    await expect(column(page, 'In review')).toBeVisible();
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '')
      .toContain('name: In review');
  });

  test('renames a stack from its own menu', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addStatus(page, 0, 'Doing');
    await turnIntoBoard(page);

    await page.getByLabel('Stack menu for Doing').click();
    const name = page.getByLabel('Stack name');
    await name.fill('Underway');
    await name.press('Enter');

    await expect(column(page, 'Underway')).toContainText('Ship it');
    await expect(page.getByLabel('Stack menu for Doing')).toHaveCount(0);
  });

  test('names the stack that holds no option and keeps its cards over a reload', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addRow(page, 'Write it');
    await turnIntoBoard(page);
    await expect(column(page, 'No Status').locator('.db-card')).toHaveCount(2);

    await page.getByLabel('Stack menu for No Status').click();
    const name = page.getByLabel('Stack name');
    await name.fill('Backlog');
    await name.press('Enter');

    await expect(column(page, 'Backlog').locator('.db-card')).toHaveCount(2);
    await expect(column(page, 'No Status').locator('.db-card')).toHaveCount(0);
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '', {
        message: 'the new option never reached the database page',
      })
      .toContain('name: Backlog');

    await page.reload();

    await expect(board(page)).toBeVisible();
    await expect(column(page, 'Backlog')).toContainText('Ship it');
    await expect(column(page, 'Backlog')).toContainText('Write it');
    await expect(column(page, 'No Status').locator('.db-card')).toHaveCount(0);
  });

  test('deletes a stack and leaves its cards on the board', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addStatus(page, 0, 'Doing');
    await turnIntoBoard(page);

    await page.getByLabel('Stack menu for Doing').click();
    await page.getByRole('menuitem', { name: 'Delete stack' }).click();

    await expect(page.getByLabel('Stack menu for Doing')).toHaveCount(0);
    await expect(column(page, 'No Status')).toContainText('Ship it');
  });

  test('moves a card from its own menu', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addStatus(page, 0, 'Doing');
    await addRow(page, 'Write it');
    await turnIntoBoard(page);

    await card(page, 'Write it').getByLabel('Card menu for Write it').click();
    await page.getByRole('menuitem', { name: 'Doing' }).click();

    await expect(column(page, 'Doing')).toContainText('Write it');
  });

  test('sends a card back to the stack that holds no option', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addStatus(page, 0, 'Doing');
    await turnIntoBoard(page);

    await card(page, 'Ship it').getByLabel('Card menu for Ship it').click();
    await page.getByRole('menuitem', { name: 'No Status' }).click();

    await expect(column(page, 'No Status')).toContainText('Ship it');
    await expect(column(page, 'Doing').locator('.db-card')).toHaveCount(0);
  });

  test('creates a card that already holds the option of its stack', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addStatus(page, 0, 'Doing');
    await turnIntoBoard(page);

    await column(page, 'Doing').getByRole('button', { name: 'New card in Doing' }).click();

    await expect(column(page, 'Doing').locator('.db-card')).toHaveCount(2);
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '')
      .toContain('title: Untitled');
  });

  test('opens a card in the record panel', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await turnIntoBoard(page);

    await card(page, 'Ship it').getByRole('button', { name: 'Ship it', exact: true }).click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Row title')).toHaveValue('Ship it');
  });

  test('deletes a row from the card menu', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await expect.poll(async () => (await content.pageFileText(path)) ?? '').toContain('Ship it');
    await turnIntoBoard(page);

    await card(page, 'Ship it').getByLabel('Card menu for Ship it').click();
    await page.getByRole('menuitem', { name: 'Delete row' }).click();

    await expect(board(page).locator('.db-card')).toHaveCount(0);
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '')
      .not.toContain('Ship it');
  });

  test('keeps a table view beside the board', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');

    await page.getByLabel('Add a view').click();
    await page.getByRole('menuitem', { name: 'Board' }).click();
    await expect(board(page)).toBeVisible();

    await page.getByRole('tab', { name: 'Table' }).click();
    await expect(page.getByTestId('db-table')).toBeVisible();
    await expect(board(page)).toHaveCount(0);
  });

  test('renames the board and keeps the name over a reload', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await turnIntoBoard(page);

    await page.getByRole('tab', { selected: true }).click();
    await page.getByLabel('View name').fill('Pipeline');
    await page.getByLabel('View name').press('Enter');

    await expect(page.getByRole('tab', { name: 'Pipeline' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Pipeline' })).toBeVisible();
  });

  test('survives a reload with its stacks and its cards intact', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);
    await addRow(page, 'Ship it');
    await addStatus(page, 0, 'Doing');
    await turnIntoBoard(page);

    await page.reload();

    await expect(board(page)).toBeVisible();
    await expect(column(page, 'Doing')).toContainText('Ship it');
  });

  test('asks for a select column when the database has none', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await openDatabase(page);

    const table = page.getByTestId('db-table');
    await table.getByRole('button', { name: /^Status/ }).click();
    await page.getByRole('menuitem', { name: 'Delete property' }).click();
    await expect(table.getByRole('button', { name: /^Status/ })).toHaveCount(0);

    await page.getByRole('tab', { selected: true }).click();
    await page.getByLabel('View layout').selectOption('board');

    await expect(db(page).getByText(/A board stacks its cards by a select column/)).toBeVisible();
  });
});
