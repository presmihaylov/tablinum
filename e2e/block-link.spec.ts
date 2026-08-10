import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient } from './fixtures';

/**
 * A link to one block. The menu on the grip copies it, and the link opens the page at that
 * block and lights it. The words of the block are the whole address, so the markdown file
 * never gains an id.
 */

const FIRST = 'Run the pipeline every Friday.';
const TARGET = 'The release notes go out on Monday.';
const FILLER = Array.from({ length: 30 }, (_, index) => `Filler line ${index + 1}.`).join('\n\n');
const BODY = `${FIRST}\n\n${FILLER}\n\n${TARGET}\n`;

function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

function litBlock(page: Page): Locator {
  return editorBody(page).locator('.gd-block-linked');
}

/** Bring the handles up beside a paragraph and open the menu on it. */
async function openMenu(page: Page, text: string): Promise<Locator> {
  await editorBody(page).locator('p', { hasText: text }).hover();
  const grip = page.getByRole('button', { name: 'Block actions' });
  await expect(grip).toBeVisible();
  await grip.click();
  const menu = page.getByRole('menu', { name: 'Block actions' });
  await expect(menu).toBeVisible();
  return menu;
}

async function seedPage(api: ApiClient, name: string): Promise<{ path: string; href: string }> {
  const space = await api.createUniqueSpace('blocklink');
  const path = `${space.slug}/${name}`;
  await api.createPage({ path, title: name, markdown: BODY });
  return { path, href: `/p/${path}` };
}

/** Copy the link to a block and give back what landed on the clipboard. */
async function copyLinkTo(page: Page, text: string): Promise<string> {
  await (await openMenu(page, text)).getByRole('menuitem', { name: 'Copy link to block' }).click();
  await expect(page.getByText('Link to the block copied')).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('a link to one block', () => {
  test.beforeEach(async ({ context }: { context: BrowserContext }) => {
    // Reading the clipboard back is the only way to see what the menu item produced.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('the menu copies a link that names the block by its words', async ({ page, api }) => {
    const seeded = await seedPage(api, 'copy');

    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(TARGET);

    const link = await copyLinkTo(page, TARGET);

    const origin = new URL(page.url()).origin;
    expect(link).toBe(`${origin}/p/${seeded.path}#the-release-notes-go-out-on-monday`);
  });

  test('the link opens the page at the block and lights it', async ({ page, api }) => {
    const seeded = await seedPage(api, 'open');

    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(TARGET);
    const link = await copyLinkTo(page, TARGET);

    await page.goto(link);

    await expect(litBlock(page)).toHaveText(TARGET);
    // Far enough down the page that only a scroll could bring it into the window.
    await expect(litBlock(page)).toBeInViewport();
  });

  test('the file gains no id from a link', async ({ page, api, content }) => {
    const seeded = await seedPage(api, 'untouched');
    await content.waitForPageFile(seeded.path);
    const before = await content.pageFileText(seeded.path);

    await page.goto(seeded.href);
    await expect(editorBody(page)).toContainText(TARGET);
    await copyLinkTo(page, TARGET);
    await page.goto(`/p/${seeded.path}#the-release-notes-go-out-on-monday`);
    await expect(litBlock(page)).toHaveText(TARGET);

    expect(await content.pageFileText(seeded.path)).toBe(before);
  });

  test('a link whose words are gone leaves the page as it is', async ({ page, api }) => {
    const seeded = await seedPage(api, 'stale');

    await page.goto(`/p/${seeded.path}#a-line-nobody-ever-wrote`);

    await expect(editorBody(page)).toContainText(FIRST);
    await expect(litBlock(page)).toHaveCount(0);
  });
});
