import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { newPageFromPalette } from './palette';
import { pageTree } from './sidebar';

/** The sidebar tree, the only place page rows are asserted on. */
function sidebar(page: Page): Locator {
  return pageTree(page);
}

/** The clickable title of a page row. Rows have no role of their own. */
function row(page: Page, title: string): Locator {
  return sidebar(page).getByText(title, { exact: true });
}

/**
 * The tree item of a page. An ancestor item contains the text of every descendant, so the
 * innermost match is the wanted one.
 */
function rowItem(page: Page, title: string): Locator {
  return sidebar(page).getByRole('treeitem').filter({ hasText: title }).last();
}

/**
 * The row actions are `display: none` until the row is hovered, and a hover is a single mouse
 * move that Playwright does not repeat when it retries the click. Favourites are not optimistic,
 * so a row can still slide out from under the pointer a round trip after the click that pinned
 * it. Hover and click therefore go together, and the pair is retried as one.
 */
async function clickRowAction(page: Page, title: string, action: string): Promise<void> {
  const item = rowItem(page, title);
  await expect(item).toBeVisible();
  await expect(async () => {
    await item.hover();
    await item.getByRole('button', { name: action }).click({ timeout: 1000 });
  }).toPass();
}

/** Open the "..." menu of a page row. */
async function openRowMenu(page: Page, title: string): Promise<void> {
  await clickRowAction(page, title, `Page options for ${title}`);
  await expect(page.getByRole('menu')).toBeVisible();
}

/** Move the caret out of the title and into the body, the way Enter does for a writer. */
async function typeInBody(page: Page, text: string): Promise<void> {
  const title = page.getByLabel('Page title');
  await title.click();
  await title.press('Enter');
  // The caret reaches the body a tick later, and until then the title still takes the keys.
  await expect(title).not.toBeFocused();
  await page.keyboard.type(text);
}

test.describe('page lifecycle', () => {
  // Every test owns a space, so no test can see another one's pages.
  let slug = '';

  test.beforeEach(async ({ api }) => {
    // Seeding happens before the first goto: the tree is fetched once and a write made
    // outside the browser would not invalidate it.
    slug = (await api.createUniqueSpace('lifecycle')).slug;
  });

  test('creates a page from the palette, in the tree and on disk', async ({ page, content }) => {
    await page.goto(`/p/${slug}`);
    await expect(row(page, slug)).toBeVisible();

    await newPageFromPalette(page, 'Release notes');

    await expect(page).toHaveURL(`/p/${slug}/release-notes`);
    await expect(row(page, 'Release notes')).toBeVisible();
    await expect(page.getByLabel('Page title')).toHaveValue('Release notes');

    const file = await content.waitForPageFile(`${slug}/release-notes`);
    expect(await content.read(file)).toContain('title: Release notes');
  });

  test('saves typed content to the markdown file and keeps it over a reload', async ({
    page,
    api,
    content,
  }) => {
    const body = 'The release ships on Friday.';
    await api.createPage({ path: `${slug}/notes`, title: 'Notes' });

    await page.goto(`/p/${slug}/notes`);
    await expect(page.getByLabel('Page title')).toHaveValue('Notes');

    await typeInBody(page, body);
    // Cmd+S flushes the debounced autosave, so the assertion never waits on a timer.
    await page.keyboard.press('ControlOrMeta+s');

    const file = await content.waitForPageFile(`${slug}/notes`);
    await expect
      .poll(async () => (await content.read(file)) ?? '', { message: `${file} never held the body` })
      .toContain(body);

    await page.reload();
    await expect(page.getByLabel('Page title')).toHaveValue('Notes');
    await expect(page.getByText(body)).toBeVisible();
  });

  test('renames a page and the file moves with it', async ({ page, api, content }) => {
    await api.createPage({ path: `${slug}/draft`, title: 'Draft' });
    await content.waitForPageFile(`${slug}/draft`);

    await page.goto(`/p/${slug}/draft`);
    await expect(row(page, 'Draft')).toBeVisible();

    await openRowMenu(page, 'Draft');
    await page.getByRole('menuitem', { name: 'Rename' }).click();

    const dialog = page.getByRole('dialog', { name: 'Rename page' });
    await dialog.getByLabel('Page title').fill('Published notes');
    await dialog.getByRole('button', { name: 'Rename' }).click();

    // The open page follows its own rename.
    await expect(page).toHaveURL(`/p/${slug}/published-notes`);
    await expect(row(page, 'Published notes')).toBeVisible();
    await expect(row(page, 'Draft')).toHaveCount(0);

    await content.waitForFileGone(`${slug}/draft.md`);
    const file = await content.waitForPageFile(`${slug}/published-notes`);
    expect(await content.read(file)).toContain('title: Published notes');
  });

  test('deletes a page from the tree and from disk', async ({ page, api, content }) => {
    await api.createPage({ path: `${slug}/scratch`, title: 'Scratch' });
    await content.waitForPageFile(`${slug}/scratch`);

    await page.goto(`/p/${slug}/scratch`);
    await expect(row(page, 'Scratch')).toBeVisible();

    await openRowMenu(page, 'Scratch');
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete page' });
    await expect(dialog.getByText('Delete "Scratch"? The file is removed from the repo.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    // The deleted page was open, so the parent takes over.
    await expect(page).toHaveURL(`/p/${slug}`);
    await expect(row(page, 'Scratch')).toHaveCount(0);
    await content.waitForFileGone(`${slug}/scratch.md`);
  });

  test('adds a child page and moves between the parent and the child', async ({
    page,
    api,
    content,
  }) => {
    await api.createPage({ path: `${slug}/handbook`, title: 'Handbook' });

    await page.goto(`/p/${slug}/handbook`);
    await expect(row(page, 'Handbook')).toBeVisible();

    await clickRowAction(page, 'Handbook', 'Add a page inside Handbook');
    const dialog = page.getByRole('dialog', { name: 'New page' });
    await dialog.getByLabel('Page title').fill('Onboarding');
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(`/p/${slug}/handbook/onboarding`);
    await expect(row(page, 'Onboarding')).toBeVisible();

    // The breadcrumb spells out the parentage the tree only draws with indentation.
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Handbook' })).toBeVisible();
    await expect(crumbs.getByRole('link', { name: 'Onboarding' })).toBeVisible();

    // A page with a child is stored as a directory with an index file.
    await content.waitForFile(`${slug}/handbook/index.md`);
    await content.waitForFileGone(`${slug}/handbook.md`);
    await content.waitForFile(`${slug}/handbook/onboarding.md`);

    await crumbs.getByRole('link', { name: 'Handbook' }).click();
    await expect(page).toHaveURL(`/p/${slug}/handbook`);
    await expect(page.getByLabel('Page title')).toHaveValue('Handbook');
    // The parent is no longer an ancestor of the open page, so it folds its child away.
    await expect(row(page, 'Onboarding')).toHaveCount(0);

    await rowItem(page, 'Handbook').getByRole('button', { name: 'Expand' }).click();
    await row(page, 'Onboarding').click();
    await expect(page).toHaveURL(`/p/${slug}/handbook/onboarding`);
    await expect(page.getByLabel('Page title')).toHaveValue('Onboarding');
  });
});
