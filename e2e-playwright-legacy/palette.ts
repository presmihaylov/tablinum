import { expect, type Locator, type Page } from '@playwright/test';

/** Open the command palette from the top bar. */
export async function openPalette(page: Page): Promise<Locator> {
  await page.getByRole('banner').getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  return palette;
}

/** Run the "New page" action and fill in the dialog it opens. */
export async function newPageFromPalette(page: Page, title: string): Promise<void> {
  const palette = await openPalette(page);
  await palette.getByRole('option', { name: 'New page' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Page title').fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
}
