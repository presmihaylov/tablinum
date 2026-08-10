import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

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

/** Add a row and wait for it to arrive under the title it was given. */
async function addRow(page: Page, title: string): Promise<void> {
  const before = (await titles(page)).length;
  // An accessible name matches on a substring, so the exact one keeps other buttons out.
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
  let pageId = '';

  test.beforeEach(async ({ api }) => {
    slug = (await api.createUniqueSpace('db')).slug;
    path = `${slug}/tasks`;
    const created = await api.createPage({
      path,
      title: 'Tasks',
      markdown: 'The plan lives below.\n',
    });
    pageId = created.id;
    await api.makeDatabase(pageId);
  });

  test('writes the schema into the page file and leaves the body alone', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await expect(grid(page)).toBeVisible();

    await expect(grid(page).getByRole('button', { name: /^Status/ })).toBeVisible();
    await expect(grid(page).getByRole('button', { name: /^Notes/ })).toBeVisible();

    const file = await content.waitForPageFile(path);
    await expect.poll(async () => (await content.read(file)) ?? '').toContain('db:');
    const raw = (await content.read(file)) ?? '';
    expect(raw).toContain('name: Status');
    expect(raw).toContain('The plan lives below.');
  });

  test('writes a row and its cells into the database page, not into a page of its own', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await addRow(page, 'Ship it');

    // The row lands first and the typed title a moment later, so poll for the title itself.
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '', {
        message: 'the row title never reached the database page',
      })
      .toContain('title: Ship it');

    const notes = (await rowOf(page, 'Ship it')).getByLabel('Notes');
    await notes.fill('Before Friday');
    await notes.press('Enter');

    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '', {
        message: 'the cell never reached the database page',
      })
      .toContain('Before Friday');

    // A row is a record, so the database page never gains a child and is never promoted.
    expect(await content.read(`${path}.md`)).not.toBeNull();
    expect(await content.read(`${path}/index.md`)).toBeNull();
  });

  test('keeps a row out of the sidebar tree', async ({ page, api }) => {
    await page.goto(`/p/${path}`);
    await addRow(page, 'Ship it');

    await expect
      .poll(async () => (await api.listPages()).map((entry) => entry.title))
      .not.toContain('Ship it');
  });

  test('creates a select option from a cell and keeps it in the schema', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
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

  test('opens a column menu the grid cannot clip', async ({ page }) => {
    await page.goto(`/p/${path}`);
    await expect(grid(page)).toBeVisible();

    // Enough columns to make the grid scroll sideways. The last one used to open a menu that
    // the scroller cut in half, because the menu was drawn inside the scroller. Each add waits
    // for its own column, so the count below counts what this loop asked for.
    for (let n = 0; n < 6; n += 1) {
      const columns = grid(page).getByRole('columnheader');
      const before = await columns.count();
      await grid(page).getByLabel('Add a property').click();
      await expect(columns).toHaveCount(before + 1);
    }
    const last = grid(page).getByRole('columnheader').nth(-2).getByRole('button');
    await expect(last).toBeVisible();
    const scrolled = await grid(page).evaluate((node) => {
      const scroller = node.closest('.db__scroll');
      if (scroller === null) return 0;
      scroller.scrollLeft = scroller.scrollWidth;
      return scroller.scrollLeft;
    });
    // Without an overflow there is nothing to clip, so the rest of the test would prove nothing.
    expect(scrolled).toBeGreaterThan(0);

    await last.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // It hangs off the body, so no scroller of the grid owns it.
    await expect(page.locator('.db__scroll').getByRole('menu')).toHaveCount(0);
    const box = await menu.boundingBox();
    const size = page.viewportSize();
    expect(box).not.toBeNull();
    expect(size).not.toBeNull();
    if (box === null || size === null) return;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
  });

  // A schema write sends the whole schema the browser holds. Two of them from one starting point
  // used to overwrite each other, so the second click ate the first click's column.
  test('keeps both columns from a pair of quick clicks on Add a property', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await expect(grid(page)).toBeVisible();

    const columns = grid(page).getByRole('columnheader');
    const before = await columns.count();
    const add = grid(page).getByLabel('Add a property');
    await add.click();
    await add.click();

    // Both clicks read the same schema, so both pick the same free name. Two columns is the
    // point; the person renames one. Losing one was the bug.
    await expect(columns).toHaveCount(before + 2);
    await expect(grid(page).getByRole('button', { name: /^Property/ })).toHaveCount(2);

    // Both reached the file, so neither survived only in the browser.
    const file = await content.waitForPageFile(path);
    await expect.poll(async () => {
      const raw = (await content.read(file)) ?? '';
      return raw.split('name: Property').length - 1;
    }).toBe(2);
  });

  test('renames a column and hides it from the view', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await expect(grid(page)).toBeVisible();

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

  test('opens a row in the record panel and saves what is edited there', async ({
    page,
    content,
  }) => {
    await page.goto(`/p/${path}`);
    await addRow(page, 'Ship it');

    await (await rowOf(page, 'Ship it')).getByRole('button', { name: 'Open' }).click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Row title')).toHaveValue('Ship it');

    await panel.getByLabel('Notes').fill('Before Friday');
    await panel.getByLabel('Notes').press('Enter');

    // The cell menus draw in a layer on the body now. The layer must sit over the panel, or
    // nobody could pick anything from a cell opened here.
    const status = panel.getByRole('button', { name: 'Status', exact: true });
    await status.click();
    const options = page.getByRole('menu', { name: 'Status options' });
    await expect(options).toBeVisible();
    await expect(page.locator('.modal').getByRole('menu')).toHaveCount(0);
    await options.getByLabel('Search Status options').fill('Doing');
    await options.getByRole('menuitem', { name: /Create/ }).click();
    await expect(status).toContainText('Doing');

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expect(panel).toHaveCount(0);
    await expect((await rowOf(page, 'Ship it')).getByLabel('Notes')).toHaveValue('Before Friday');
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '')
      .toContain('Before Friday');
  });

  test('deletes a row from the grid', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await addRow(page, 'Ship it');
    await expect.poll(async () => (await content.pageFileText(path)) ?? '').toContain('Ship it');

    await page.getByRole('button', { name: 'Row menu for Ship it' }).click();
    await page.getByRole('menuitem', { name: 'Delete row' }).click();

    await expect.poll(async () => titles(page)).toEqual([]);
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '')
      .not.toContain('Ship it');
  });

  test('takes the database off a page, and the rows go with it', async ({ page, content, api }) => {
    await page.goto(`/p/${path}`);
    await addRow(page, 'Ship it');
    await expect.poll(async () => (await content.pageFileText(path)) ?? '').toContain('Ship it');

    await api.removeDatabase(pageId);
    await page.reload();
    await expect(grid(page)).toHaveCount(0);

    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '', {
        message: 'the db block is still in the page file',
      })
      .not.toContain('db:');
    expect((await content.pageFileText(path)) ?? '').not.toContain('rows:');
  });

  test('commits every database write to git', async ({ page, content, api }) => {
    await page.goto(`/p/${path}`);
    await addRow(page, 'Ship it');
    await expect.poll(async () => (await content.pageFileText(path)) ?? '').toContain('Ship it');

    await api.commit();
    await expect.poll(async () => content.dirtyFiles()).toEqual([]);
    expect(await content.trackedFiles()).toContain(`${path}.md`);
  });

  test('survives a reload with its schema and its rows intact', async ({ page }) => {
    await page.goto(`/p/${path}`);
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
