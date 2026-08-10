import type { Locator, Page } from '@playwright/test';
import { expect, test, uniqueSlug, type ApiClient } from './fixtures';

const SPACE_NAME = 'Tree Space';

interface Seeded {
  slug: string;
  home: string;
  guides: string;
  install: string;
  upgrade: string;
  reference: string;
}

/** The space the running test owns, so the afterEach hook can take it away again. */
let seededSlug: string | null = null;

/** A space of its own for every test, so no spec ever waits on another one's pages. */
async function seedSpace(api: ApiClient): Promise<Seeded> {
  const space = await api.createSpace({ slug: uniqueSlug('tree'), name: SPACE_NAME });
  const slug = space.slug;
  seededSlug = slug;

  await api.createPage({ path: `${slug}/guides`, title: 'Guides', order: 1 });
  await api.createPage({ path: `${slug}/guides/install`, title: 'Install', order: 1 });
  await api.createPage({ path: `${slug}/guides/upgrade`, title: 'Upgrade', order: 2 });
  await api.createPage({ path: `${slug}/reference`, title: 'Reference', order: 2 });

  return {
    slug,
    home: slug,
    guides: `${slug}/guides`,
    install: `${slug}/guides/install`,
    upgrade: `${slug}/guides/upgrade`,
    reference: `${slug}/reference`,
  };
}

/**
 * The row of a page in the sidebar. A treeitem holds its descendants, so its accessible name
 * also holds their titles; the title span is the only part that belongs to the row alone.
 */
function row(page: Page, title: string): Locator {
  return page.getByRole('navigation', { name: 'Pages' }).getByText(title, { exact: true }).locator('..');
}

function twisty(page: Page, title: string, label: 'Expand' | 'Collapse'): Locator {
  return row(page, title).getByRole('button', { name: label });
}

/** The <li role="treeitem"> around a row, which carries aria-expanded. */
function treeItem(page: Page, title: string): Locator {
  return row(page, title).locator('..');
}

/** Open the space home page and unfold it, since every other page of the space hangs off it. */
async function openSpaceHome(page: Page, home: string): Promise<void> {
  await page.goto(`/p/${home}`);
  await twisty(page, SPACE_NAME, 'Expand').click();
  await expect(row(page, 'Guides')).toBeVisible();
}

test.describe('page tree and navigation', () => {
  // A space has no delete endpoint, so its directory goes from disk and the watcher re-indexes.
  test.afterEach(async ({ api, content }) => {
    const slug = seededSlug;
    seededSlug = null;
    if (slug === null) return;
    await content.remove(slug);
    await expect
      .poll(async () => (await api.spaces()).map((space) => space.slug))
      .not.toContain(slug);
  });

  test('the tree renders the pages of the content directory', async ({ page, api, content }) => {
    const seeded = await seedSpace(api);
    await page.goto(`/p/${seeded.home}`);

    // The space home page is the root row, and every page of the space hangs off it.
    await expect(row(page, SPACE_NAME)).toBeVisible();
    await expect(treeItem(page, SPACE_NAME)).toHaveAttribute('aria-expanded', 'false');
    await expect(row(page, 'Guides')).toHaveCount(0);

    await twisty(page, SPACE_NAME, 'Expand').click();

    await expect(row(page, 'Guides')).toBeVisible();
    await expect(row(page, 'Reference')).toBeVisible();

    // Guides is closed on a fresh visit, so its children are not in the tree at all.
    await expect(row(page, 'Install')).toHaveCount(0);
    await expect(treeItem(page, 'Guides')).toHaveAttribute('aria-expanded', 'false');
    // A page without children carries no expanded state.
    await expect(treeItem(page, 'Reference')).not.toHaveAttribute('aria-expanded', /.*/);

    // Every row the tree draws is a markdown file in the repo.
    for (const path of [seeded.home, seeded.guides, seeded.install, seeded.reference]) {
      const file = await content.waitForPageFile(path);
      expect(await content.read(file)).toContain('title:');
    }
  });

  test('a parent expands and collapses', async ({ page, api }) => {
    const seeded = await seedSpace(api);
    await openSpaceHome(page, seeded.home);

    await twisty(page, 'Guides', 'Expand').click();

    await expect(treeItem(page, 'Guides')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'Install')).toBeVisible();
    await expect(row(page, 'Upgrade')).toBeVisible();

    await twisty(page, 'Guides', 'Collapse').click();

    await expect(treeItem(page, 'Guides')).toHaveAttribute('aria-expanded', 'false');
    await expect(row(page, 'Install')).toHaveCount(0);
    await expect(row(page, 'Upgrade')).toHaveCount(0);
  });

  test('a click in the tree opens the page and changes the URL', async ({ page, api }) => {
    const seeded = await seedSpace(api);
    await openSpaceHome(page, seeded.home);

    await row(page, 'Reference').click();

    await expect(page).toHaveURL(`/p/${seeded.reference}`);
    await expect(page.getByLabel('Page title')).toHaveValue('Reference');

    await twisty(page, 'Guides', 'Expand').click();
    await row(page, 'Install').click();

    await expect(page).toHaveURL(`/p/${seeded.install}`);
    await expect(page.getByLabel('Page title')).toHaveValue('Install');

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.getByRole('link', { name: 'Guides' })).toBeVisible();
    await expect(breadcrumb.getByRole('link', { name: 'Install' })).toBeVisible();
  });

  test('a deep link opens the page and reveals it in the tree', async ({ page, api }) => {
    const seeded = await seedSpace(api);

    await page.goto(`/p/${seeded.install}`);

    await expect(page.getByLabel('Page title')).toHaveValue('Install');
    // The ancestors of the open page open themselves, whatever the stored tree state says.
    await expect(treeItem(page, 'Guides')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'Install')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Install' })).toBeVisible();
  });

  test('the back and forward buttons walk the pages that were opened', async ({ page, api }) => {
    const seeded = await seedSpace(api);
    await openSpaceHome(page, seeded.home);

    await row(page, 'Guides').click();
    await expect(page).toHaveURL(`/p/${seeded.guides}`);

    await row(page, 'Reference').click();
    await expect(page).toHaveURL(`/p/${seeded.reference}`);

    await page.goBack();
    await expect(page).toHaveURL(`/p/${seeded.guides}`);
    await expect(page.getByLabel('Page title')).toHaveValue('Guides');

    await page.goBack();
    await expect(page).toHaveURL(`/p/${seeded.home}`);
    await expect(page.getByLabel('Page title')).toHaveValue(SPACE_NAME);

    await page.goForward();
    await expect(page).toHaveURL(`/p/${seeded.guides}`);
    await expect(page.getByLabel('Page title')).toHaveValue('Guides');

    await page.goForward();
    await expect(page).toHaveURL(`/p/${seeded.reference}`);
    await expect(page.getByLabel('Page title')).toHaveValue('Reference');
  });

  test('a page dragged onto another page moves under it', async ({ page, api, content }) => {
    const seeded = await seedSpace(api);
    await openSpaceHome(page, seeded.home);

    await twisty(page, 'Guides', 'Expand').click();
    await expect(row(page, 'Install')).toBeVisible();

    // The middle of a row is the "drop inside" band, so the drag re-parents instead of reordering.
    await row(page, 'Install').dragTo(row(page, 'Reference'));

    await expect(treeItem(page, 'Reference')).toHaveAttribute('aria-expanded', 'true');
    // The row now sits inside the Reference branch of the tree.
    await expect(treeItem(page, 'Reference').getByText('Install', { exact: true })).toBeVisible();

    const moved = `${seeded.reference}/install`;
    await expect.poll(async () => (await api.getPage(moved))?.path ?? null).toBe(moved);
    expect(await api.getPage(seeded.install)).toBeNull();

    await content.waitForPageFile(moved);
    await expect.poll(() => content.pageFile(seeded.install)).toBeNull();

    // The move survives a reload, so it is the server's state and not local tree state.
    await page.reload();
    await expect(row(page, 'Install')).toBeVisible();
    await row(page, 'Install').click();
    await expect(page).toHaveURL(`/p/${moved}`);
  });

  test('a page created through the API shows up after a refresh', async ({ page, api }) => {
    const seeded = await seedSpace(api);
    await openSpaceHome(page, seeded.home);
    await expect(row(page, 'Reference')).toBeVisible();

    const created = await api.createPage({
      path: `${seeded.slug}/changelog`,
      title: 'Changelog',
      markdown: 'Seeded over the REST API.\n',
      order: 3,
    });
    expect(created.path).toBe(`${seeded.slug}/changelog`);

    await page.reload();

    await expect(row(page, 'Changelog')).toBeVisible();
    await row(page, 'Changelog').click();
    await expect(page).toHaveURL(`/p/${seeded.slug}/changelog`);
    await expect(page.getByLabel('Page title')).toHaveValue('Changelog');
  });
});
