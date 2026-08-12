import { mkdir, writeFile } from 'node:fs/promises';
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

/** A well-formed page id no page in the tree answers to, so its attachments are orphans. */
const ORPHAN_PAGE_ID = 'pg_0E2E0RESCAN000000000000000';

/** One red pixel, so the orphan the rescan collects is a real attachment. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

  // The avatar sits at the left of the sidebar, and its menu is almost as wide as the sidebar.
  // Hung off the right edge of the avatar, the menu used to run off the side of the window.
  test('the account menu opens inside the window, even on a small screen', async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 520 });
    await page.goto('/');

    await page.getByRole('button', { name: 'Your account' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    const size = page.viewportSize();
    expect(box).not.toBeNull();
    expect(size).not.toBeNull();
    if (box === null || size === null) return;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);

    // It hangs off the body, so nothing in the sidebar can clip it.
    await expect(page.locator('.sidebar').getByRole('menu')).toHaveCount(0);
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
    // One page now carries the workspace, its people and the invites.
    await expect(page.getByRole('region', { name: 'People in this workspace' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Accounts' })).toBeVisible();
    await expect(page.getByText('Invite somebody')).toBeVisible();
    await expect(page.getByRole('link', { name: /Export as a zip/ })).toBeVisible();

    await nav(page).getByRole('button', { name: 'Agents' }).click();
    await expect(page).toHaveURL(/\/settings\/agents$/);
    await expect(page.getByLabel('Agent name')).toBeVisible();

    // The section list puts the workspace right under the account.
    await expect(nav(page).getByRole('button')).toHaveText([
      'Back to the pages',
      'My account',
      'Workspace',
      'Custom emoji',
      'Agents',
    ]);

    // People and invites was a section of its own. The old link still lands on the right page.
    await page.goto('/settings/people');
    await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible();
  });

  test('the workspace menu reaches settings too, and the way back works', async ({ page }) => {
    await page.goto('/');

    await page.locator('.sidebar').getByRole('button', { name: 'Workspace' }).click();

    // The menu holds one door to the settings page, not one for each section.
    await expect(page.getByRole('menuitem', { name: 'Invite members' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Workspace settings' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /Import/ })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();

    await nav(page).getByRole('button', { name: 'Back to the pages' }).click();
    await expect(page).toHaveURL(/\/p\//);
  });

  /**
   * The rescan route used to be reachable only by a hand-written curl. The operator who needs
   * it has just restored a backup, so it belongs on the settings page. It deletes files, so it
   * asks first and names every file it took.
   */
  test('an admin rescans the content directory and reads what it removed', async ({
    page,
    content,
  }) => {
    // An attachment directory named after a page that never existed, which is the shape a
    // restore from a backup leaves behind. Written straight to disk: the upload route refuses
    // a page id it cannot find, and the watcher never sweeps, so only a rescan collects this.
    const orphanDir = `_assets/${ORPHAN_PAGE_ID}`;
    const orphanFile = `${orphanDir}/left-behind.png`;
    await mkdir(content.path(orphanDir), { recursive: true });
    await writeFile(content.path(orphanFile), PNG_BYTES);

    await page.goto('/settings/workspace');
    const section = page.getByRole('region', { name: 'Rescan the content directory' });
    await expect(section).toBeVisible();
    await expect(section).toContainText('deletes the attachment files of pages that are gone');

    await section.getByRole('button', { name: 'Rescan' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('deletes the attachment files of pages that are gone');
    await expect(dialog).toContainText('no history to restore from');
    // The dialog is a sibling of the section, so nothing has run while it is open.
    expect(await content.exists(orphanFile)).toBe(true);

    await dialog.getByRole('button', { name: 'Rescan' }).click();

    await expect(section).toContainText(orphanFile);
    await expect(section).toContainText(/The search index now holds \d+ page/);
    await expect
      .poll(() => content.exists(orphanFile), { message: 'the orphan attachment is still on disk' })
      .toBe(false);
  });
});
