import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pageMenu } from './menus';

/** The database on the open page: its tools and its grid. */
function db(page: Page): Locator {
  return page.getByRole('region', { name: 'Database' });
}

/** The grid of the database on the open page. */
function grid(page: Page): Locator {
  return page.getByTestId('db-table');
}

/**
 * The row of the grid whose title cell reads `title`. React keeps a controlled input's value
 * off the attribute, so the row is found by position among the titles the grid shows.
 */
async function rowOf(page: Page, title: string): Promise<Locator> {
  const index = (await titles(page)).indexOf(title);
  if (index < 0) throw new Error(`No row titled ${title}`);
  return grid(page).locator('tbody tr').nth(index);
}

/** Every row title the grid shows, top to bottom. */
async function titles(page: Page): Promise<string[]> {
  return grid(page).getByLabel('Row title').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLInputElement).value),
  );
}

/** Turn the open page into a database and wait for the grid. */
async function turnIntoDatabase(page: Page): Promise<void> {
  await pageMenu(page, 'Turn into a database');
  await expect(grid(page)).toBeVisible();
}

/** Add a row and wait for it to arrive under the title it was given. */
async function addRow(page: Page, title: string): Promise<void> {
  const before = (await titles(page)).length;
  // The sidebar has a "New page" button, and an accessible name matches on a substring.
  await db(page).getByRole('button', { name: 'New', exact: true }).first().click();
  await expect.poll(async () => (await titles(page)).length).toBe(before + 1);

  const untitled = grid(page).getByLabel('Row title').nth(before);
  await untitled.fill(title);
  await untitled.press('Enter');
  await expect.poll(async () => titles(page)).toContain(title);
}

test.describe('databases', () => {
  let slug = '';
  let path = '';

  test.beforeEach(async ({ api }) => {
    slug = (await api.createUniqueSpace('db')).slug;
    path = `${slug}/tasks`;
    await api.createPage({ path, title: 'Tasks', markdown: 'The plan lives below.\n' });
  });

  test('turns a page into a database and writes the schema to its file', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);

    await expect(grid(page).getByRole('button', { name: /^Status/ })).toBeVisible();
    await expect(grid(page).getByRole('button', { name: /^Notes/ })).toBeVisible();

    const file = await content.waitForPageFile(path);
    await expect.poll(async () => (await content.read(file)) ?? '').toContain('db:');
    const raw = (await content.read(file)) ?? '';
    expect(raw).toContain('name: Status');
    expect(raw).toContain('The plan lives below.');
  });

  test('adds a row as a child page and writes its cells to that page', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Ship it');

    const rowFile = await content.waitForPageFile(`${path}/untitled`);
    expect(await content.read(rowFile)).toContain('title: Ship it');

    const notes = (await rowOf(page, 'Ship it')).getByLabel('Notes');
    await notes.fill('Before Friday');
    await notes.press('Enter');

    await expect
      .poll(async () => (await content.read(rowFile)) ?? '', {
        message: 'the cell never reached the row file',
      })
      .toContain('Before Friday');
    expect(await content.read(rowFile)).toContain('props:');
  });

  test('creates a select option from a cell and keeps it in the schema', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Ship it');

    // The button of the cell, not the row and not the label: the option list sits inside the
    // row too, and it carries both the name "Status" and the name of the new option.
    const cell = (await rowOf(page, 'Ship it')).getByRole('button', { name: 'Status', exact: true });
    await cell.click();
    await page.getByLabel('Search Status options').fill('Doing');
    await page.getByRole('menuitem', { name: /Create/ }).click();

    await expect(cell).toContainText('Doing');

    const file = await content.waitForPageFile(path);
    await expect.poll(async () => (await content.read(file)) ?? '').toContain('name: Doing');
  });

  test('renames a column and hides it from the view', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);

    await grid(page).getByRole('button', { name: /^Notes/ }).click();
    await page.getByLabel('Property name').fill('Detail');
    await page.getByLabel('Property name').press('Enter');
    await expect(grid(page).getByRole('button', { name: /^Detail/ })).toBeVisible();

    await grid(page).getByRole('button', { name: /^Detail/ }).click();
    await page.getByRole('menuitem', { name: 'Hide in this view' }).click();
    await expect(grid(page).getByRole('button', { name: /^Detail/ })).toHaveCount(0);

    const file = await content.waitForPageFile(path);
    await expect.poll(async () => (await content.read(file)) ?? '').toContain('name: Detail');
    expect((await content.read(file)) ?? '').toContain('hidden:');
  });

  test('filters the rows a view shows', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Ship it');
    await addRow(page, 'Write it');

    const notes = (await rowOf(page, 'Ship it')).getByLabel('Notes');
    await notes.fill('urgent');
    await notes.press('Enter');

    await db(page).getByRole('button', { name: /^Filter/ }).click();
    await page.getByRole('button', { name: 'Add a filter' }).click();
    await page.getByLabel('Filter property').selectOption({ label: 'Notes' });
    await page.getByLabel('Filter operator').selectOption({ label: 'contains' });
    await page.getByLabel('Filter value').fill('urgent');
    await page.getByLabel('Filter value').press('Enter');

    await expect.poll(async () => titles(page)).toEqual(['Ship it']);
  });

  test('sorts the rows a view shows', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Alpha');
    await addRow(page, 'Bravo');

    for (const [title, note] of [
      ['Alpha', 'zulu'],
      ['Bravo', 'alpha'],
    ]) {
      const cell = (await rowOf(page, title as string)).getByLabel('Notes');
      await cell.fill(note as string);
      await cell.press('Enter');
    }

    await db(page).getByRole('button', { name: /^Sort/ }).click();
    await page.getByRole('button', { name: 'Add a sort' }).click();
    await page.getByLabel('Sort property').selectOption({ label: 'Notes' });

    await expect.poll(async () => titles(page)).toEqual(['Bravo', 'Alpha']);
  });

  test('opens the page a row lives on', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Ship it');

    await (await rowOf(page, 'Ship it')).getByRole('link', { name: 'Open' }).click();

    await expect(page).toHaveURL(`/p/${path}/untitled`);
    await expect(page.getByLabel('Page title')).toHaveValue('Ship it');
  });

  test('deletes a row from the grid', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Ship it');
    await content.waitForPageFile(`${path}/untitled`);

    await page.getByRole('button', { name: 'Row menu for Ship it' }).click();
    await page.getByRole('menuitem', { name: 'Delete row' }).click();

    await expect.poll(async () => titles(page)).toEqual([]);
    await content.waitForFileGone(`${path}/untitled.md`);
  });

  test('takes the database off a page and leaves its rows behind', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Ship it');
    const rowFile = await content.waitForPageFile(`${path}/untitled`);

    await pageMenu(page, 'Remove the database');
    await expect(grid(page)).toHaveCount(0);

    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '', {
        message: 'the db block is still in the page file',
      })
      .not.toContain('db:');
    expect(await content.read(rowFile)).toContain('title: Ship it');
  });

  test('commits every database write to git', async ({ page, content, api }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Ship it');
    await content.waitForPageFile(`${path}/untitled`);

    await api.commit();
    await expect.poll(async () => content.dirtyFiles()).toEqual([]);
    expect(await content.trackedFiles()).toContain(`${path}/untitled.md`);
  });

  test('survives a reload with its schema and its rows intact', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await turnIntoDatabase(page);
    await addRow(page, 'Ship it');

    const notes = (await rowOf(page, 'Ship it')).getByLabel('Notes');
    await notes.fill('Before Friday');
    await notes.press('Enter');
    await expect(notes).toHaveValue('Before Friday');

    await page.reload();

    await expect(grid(page)).toBeVisible();
    await expect.poll(async () => titles(page)).toEqual(['Ship it']);
    await expect((await rowOf(page, 'Ship it')).getByLabel('Notes')).toHaveValue('Before Friday');
  });
});
