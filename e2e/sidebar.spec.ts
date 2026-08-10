import type { Locator, Page } from '@playwright/test';
import { expect, test, uniqueSlug } from './fixtures';

/** One bucket of the sidebar. Each is a <section> with a label of its own. */
function bucket(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** The row of a page inside a bucket. A row carries no role, so the title text is the anchor. */
function row(bucketLocator: Locator, title: string): Locator {
  return bucketLocator.getByText(title, { exact: true });
}

test.describe('sidebar buckets', () => {
  test('shows every space, not only the one that is open', async ({ page, api }) => {
    const first = await api.createUniqueSpace('sidebar-a');
    const second = await api.createUniqueSpace('sidebar-b');

    await page.goto(`/p/${first.slug}`);

    const spaces = bucket(page, 'Spaces');
    await expect(row(spaces, first.name)).toBeVisible();
    await expect(row(spaces, second.name)).toBeVisible();
  });

  test('folds a bucket away and remembers it over a reload', async ({ page, api }) => {
    const space = await api.createUniqueSpace('sidebar-fold');
    await page.goto(`/p/${space.slug}`);

    const spaces = bucket(page, 'Spaces');
    const toggle = spaces.getByRole('button', { name: 'Spaces', exact: true });
    await expect(row(spaces, space.name)).toBeVisible();

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(row(spaces, space.name)).toHaveCount(0);

    await page.reload();

    await expect(bucket(page, 'Spaces').getByRole('button', { name: 'Spaces', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(row(bucket(page, 'Spaces'), space.name)).toHaveCount(0);
  });

  test('lists the pages that were opened, newest first', async ({ page, api }) => {
    const space = await api.createUniqueSpace('sidebar-recent');
    await api.createPage({ path: `${space.slug}/alpha`, title: 'Recent Alpha' });
    await api.createPage({ path: `${space.slug}/bravo`, title: 'Recent Bravo' });

    await page.goto(`/p/${space.slug}/alpha`);
    await expect(page.getByLabel('Page title')).toHaveValue('Recent Alpha');
    await page.goto(`/p/${space.slug}/bravo`);
    await expect(page.getByLabel('Page title')).toHaveValue('Recent Bravo');

    const recents = bucket(page, 'Recents');
    await expect(row(recents, 'Recent Bravo')).toBeVisible();
    await expect(row(recents, 'Recent Alpha')).toBeVisible();

    // The page just opened sits at the top of the bucket.
    const titles = await recents.getByRole('listitem').allInnerTexts();
    expect(titles.slice(0, 2)).toEqual(['Recent Bravo', 'Recent Alpha']);

    // A row of the bucket opens its page.
    await row(recents, 'Recent Alpha').click();
    await expect(page).toHaveURL(`/p/${space.slug}/alpha`);
  });

  test('creates a space from the header of the Spaces bucket', async ({ page, api }) => {
    const home = await api.createUniqueSpace('sidebar-new');
    await page.goto(`/p/${home.slug}`);

    // Already a slug, so the dialog stores it under exactly this name.
    const name = uniqueSlug('made');
    await bucket(page, 'Spaces').getByRole('button', { name: 'New space' }).click();

    const dialog = page.getByRole('dialog', { name: 'New space' });
    await dialog.getByLabel('Space name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(`/p/${name}`);
    await expect(row(bucket(page, 'Spaces'), name)).toBeVisible();
    expect((await api.spaces()).map((one) => one.slug)).toContain(name);
  });
});
