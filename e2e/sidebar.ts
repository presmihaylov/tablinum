import type { Locator, Page } from './harness';

/**
 * The page tree of the sidebar. The Recents bucket lists the same titles a few rows below,
 * so a spec that means the tree must say so.
 */
export function pageTree(page: Page): Locator {
  return page.getByRole('region', { name: 'Spaces', exact: true });
}
