import type { Page } from '@playwright/test';

/** Open the "..." menu at the top right of a page and choose one of its items. */
export async function pageMenu(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Page options' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
