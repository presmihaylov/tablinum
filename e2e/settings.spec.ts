import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ADMIN } from './env';

/**
 * Settings is a page of its own now, not a stack of dialogs, and the avatar that opens it
 * sits at the top left of the sidebar.
 */

/** The left column of the settings page. The sidebar is still on screen beside it. */
function nav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Settings' });
}

test.describe('the settings page', () => {
  test('the avatar sits in the sidebar and offers two things', async ({ page }) => {
    await page.goto('/');

    const avatar = page.getByRole('button', { name: 'Your account' });
    await expect(avatar).toBeVisible();
    // It moved out of the top bar, so the header must no longer hold it.
    await expect(page.locator('.topbar').getByRole('button', { name: 'Your account' })).toHaveCount(0);
    await expect(page.locator('.sidebar__head').getByRole('button', { name: 'Your account' })).toHaveCount(1);

    await avatar.click();
    await expect(page.getByRole('menuitem')).toHaveText(['Settings', 'Log out']);
  });

  test('Settings opens a page, not a dialog', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Your account' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Email')).toHaveValue(ADMIN.email);
  });

  test('every section is reachable, and the path names it', async ({ page }) => {
    await page.goto('/settings');

    await nav(page).getByRole('button', { name: 'Custom emoji' }).click();
    await expect(page).toHaveURL(/\/settings\/emoji$/);
    await expect(page.getByLabel('Emoji name')).toBeVisible();

    await nav(page).getByRole('button', { name: 'Workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/workspace$/);
    await expect(page.getByRole('link', { name: /Export as a zip/ })).toBeVisible();

    await nav(page).getByRole('button', { name: 'Agents' }).click();
    await expect(page).toHaveURL(/\/settings\/agents$/);
    await expect(page.getByLabel('Agent name')).toBeVisible();

    // A deep link opens the same section from cold.
    await page.goto('/settings/people');
    await expect(page.getByRole('heading', { name: 'People and invites' })).toBeVisible();
  });

  test('the workspace menu reaches settings too, and the way back works', async ({ page }) => {
    await page.goto('/');

    await page.locator('.sidebar').getByRole('button', { name: 'Workspace' }).click();

    // The menu holds one door to the settings page, not one for each section.
    await expect(page.getByRole('menuitem', { name: 'Invite members' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Workspace settings' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();

    await nav(page).getByRole('button', { name: 'Back to the pages' }).click();
    await expect(page).toHaveURL(/\/p\//);
  });
});
