import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient } from './fixtures';
import { pageMenu } from './menus';

/**
 * The "..." menu at the top right, where the avatar used to be. It turns the two side panels
 * on and off, and it carries the two actions that work on the whole page.
 */

const BODY = 'The plan for the quarter.\n';

function rail(page: Page) {
  return page.getByRole('complementary', { name: 'Page details' });
}

async function seedPage(api: ApiClient, name: string): Promise<{ path: string; href: string; space: string }> {
  const space = await api.createUniqueSpace('pagemenu');
  const path = `${space.slug}/${name}`;
  await api.createPage({ path, title: name, markdown: BODY });
  return { path, href: `/p/${path}`, space: space.slug };
}

test.describe('the page menu', () => {
  test('the rail stays off the page until the menu asks for it', async ({ page, api }) => {
    const seeded = await seedPage(api, 'quiet');

    await page.goto(seeded.href);
    await expect(page.locator('.gd-editor-surface')).toContainText(BODY.trim());
    await expect(rail(page)).toHaveCount(0);

    await pageMenu(page, 'Backlinks');
    await expect(rail(page)).toBeVisible();
    await expect(rail(page).getByRole('region', { name: 'Backlinks' })).toBeVisible();

    // The same item takes it away again.
    await pageMenu(page, 'Backlinks');
    await expect(rail(page)).toHaveCount(0);
  });

  test('history and backlinks sit in the rail together', async ({ page, api }) => {
    const seeded = await seedPage(api, 'both');

    await page.goto(seeded.href);
    await pageMenu(page, 'Backlinks');
    await pageMenu(page, 'History');

    await expect(rail(page).getByRole('region', { name: 'Backlinks' })).toBeVisible();
    await expect(rail(page).getByRole('region', { name: 'History' })).toBeVisible();
    // Both are on at once, and the order is the order of the menu.
    await expect(rail(page).getByRole('region')).toHaveCount(2);
  });

  test('the rail closes from its own button, and from Escape', async ({ page, api }) => {
    const seeded = await seedPage(api, 'dismissed');

    await page.goto(seeded.href);
    await pageMenu(page, 'History');
    await expect(rail(page)).toBeVisible();

    await rail(page).getByRole('button', { name: 'Hide the page details' }).click();
    await expect(rail(page)).toHaveCount(0);

    // Two panels on, and one Escape inside the rail takes both away.
    await pageMenu(page, 'History');
    await pageMenu(page, 'Backlinks');
    await expect(rail(page).getByRole('region')).toHaveCount(2);

    await rail(page).getByRole('button', { name: 'Hide the page details' }).focus();
    await page.keyboard.press('Escape');
    await expect(rail(page)).toHaveCount(0);
  });

  test('a backlink from another page shows up in the rail', async ({ page, api }) => {
    const target = await seedPage(api, 'target');
    await api.createPage({
      path: `${target.space}/source`,
      title: 'source',
      markdown: `See [[${target.path}]].\n`,
    });

    await page.goto(target.href);
    await pageMenu(page, 'Backlinks');

    await expect(rail(page).getByRole('link', { name: /source/ })).toBeVisible();
  });

  test('the menu deletes the page and lands somewhere else', async ({ page, api, content }) => {
    const seeded = await seedPage(api, 'doomed');
    const file = await content.waitForPageFile(seeded.path);

    await page.goto(seeded.href);
    await pageMenu(page, 'Delete');

    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page).not.toHaveURL(new RegExp(`/p/${seeded.path}$`));
    await content.waitForFileGone(file);
  });

  test('the menu moves the page into another space', async ({ page, api, content }) => {
    const seeded = await seedPage(api, 'nomad');
    const other = await api.createUniqueSpace('pagemenu-dest');

    await page.goto(seeded.href);
    await pageMenu(page, 'Move to');

    await page.getByRole('option', { name: other.name }).click();
    await page.getByRole('button', { name: 'Move', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/p/${other.slug}/nomad$`));
    await content.waitForPageFile(`${other.slug}/nomad`);
  });
});
