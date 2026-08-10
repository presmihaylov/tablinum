import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient } from './fixtures';
import { pageMenu } from './menus';
import { openPalette } from './palette';

/**
 * A favorite is one person's pin. It lives in the account database, so it survives a reload
 * and it never reaches the content directory.
 */

function bucket(page: Page): Locator {
  return page.getByRole('region', { name: 'Favorites', exact: true });
}

function row(page: Page, title: string): Locator {
  return bucket(page).getByText(title, { exact: true });
}

async function seedPage(api: ApiClient, title: string): Promise<{ id: string; href: string }> {
  const space = await api.createUniqueSpace('favorites');
  const created = await api.createPage({
    path: `${space.slug}/${title.toLowerCase()}`,
    title,
    markdown: 'The plan for the quarter.\n',
  });
  return { id: created.id, href: `/p/${created.path}` };
}

// Pins belong to the one admin the whole run signs in as, so a spec starts from none.
test.beforeEach(async ({ api }) => {
  for (const favorite of await api.favorites()) await api.removeFavorite(favorite.pageId);
});

// The seeded pages must be committed before the next spec writes, or its own commit loses the
// race with the debounced autocommit these writes armed.
test.afterEach(async ({ content }) => {
  await content.waitForCleanTree();
});

test.describe('favorites', () => {
  test('pins a page from the page menu and lists it in the bucket', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Pinned');

    await page.goto(seeded.href);
    await expect(bucket(page).getByText('No favorites yet.')).toBeVisible();

    await pageMenu(page, 'Add to favorites');

    await expect(row(page, 'Pinned')).toBeVisible();
    expect((await api.favorites()).map((one) => one.pageId)).toEqual([seeded.id]);
  });

  test('pins the open page from the command palette', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Commanded');

    await page.goto(seeded.href);
    const palette = await openPalette(page);
    await palette.getByRole('combobox').fill('favorite');
    await palette.getByRole('option', { name: 'Add to favorites' }).click();

    await expect(row(page, 'Commanded')).toBeVisible();
    expect((await api.favorites()).map((one) => one.pageId)).toEqual([seeded.id]);
  });

  test('keeps the pin over a reload, and opens the page from the bucket', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Durable');
    const elsewhere = await seedPage(api, 'Elsewhere');
    await api.addFavorite(seeded.id);

    await page.goto(elsewhere.href);
    await expect(row(page, 'Durable')).toBeVisible();

    await page.reload();
    await row(page, 'Durable').click();

    await expect(page).toHaveURL(seeded.href);
  });

  test('takes the pin off from the star on the row', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Temporary');
    await api.addFavorite(seeded.id);

    await page.goto(seeded.href);
    await expect(row(page, 'Temporary')).toBeVisible();

    await bucket(page).getByRole('button', { name: 'Remove Temporary from favorites' }).click();

    await expect(bucket(page).getByText('No favorites yet.')).toBeVisible();
    expect(await api.favorites()).toEqual([]);
  });

  test('takes the pin off from the page menu, which says so', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Toggled');
    await api.addFavorite(seeded.id);

    await page.goto(seeded.href);
    await expect(row(page, 'Toggled')).toBeVisible();

    await pageMenu(page, 'Remove from favorites');

    await expect(bucket(page).getByText('No favorites yet.')).toBeVisible();
    expect(await api.favorites()).toEqual([]);
  });

  test('pins and unpins from the star in the page header', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Starred');

    await page.goto(seeded.href);
    const star = page.getByRole('button', { name: 'Add to your favorites' });
    // It sits beside the page menu, so one click pins without opening anything.
    await expect(star).toBeVisible();
    await star.click();

    await expect(row(page, 'Starred')).toBeVisible();
    expect((await api.favorites()).map((one) => one.pageId)).toEqual([seeded.id]);

    const filled = page.getByRole('button', { name: 'Remove from your favorites' });
    await expect(filled).toHaveAttribute('aria-pressed', 'true');
    await filled.click();

    await expect(bucket(page).getByText('No favorites yet.')).toBeVisible();
    expect(await api.favorites()).toEqual([]);
  });

  test('pins a page from the tree row menu', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Contextual');

    await page.goto(seeded.href);
    const treeRow = page.getByRole('region', { name: 'Spaces', exact: true }).getByText('Contextual', {
      exact: true,
    });
    await treeRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to favorites', exact: true }).click();

    await expect(row(page, 'Contextual')).toBeVisible();
  });

  test('drops the pin when the page is deleted', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Doomed');
    await api.addFavorite(seeded.id);

    await page.goto(seeded.href);
    await expect(row(page, 'Doomed')).toBeVisible();

    await pageMenu(page, 'Delete');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(bucket(page).getByText('No favorites yet.')).toBeVisible();
    expect(await api.favorites()).toEqual([]);
  });

  test('folds the bucket away and remembers it over a reload', async ({ page, api }) => {
    const seeded = await seedPage(api, 'Hidden');
    await api.addFavorite(seeded.id);

    await page.goto(seeded.href);
    const toggle = bucket(page).getByRole('button', { name: 'Favorites', exact: true });
    await expect(row(page, 'Hidden')).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(row(page, 'Hidden')).toHaveCount(0);

    await page.reload();

    await expect(bucket(page).getByRole('button', { name: 'Favorites', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
