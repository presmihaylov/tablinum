import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient, ContentRepo } from './fixtures';

/**
 * Dragging over several blocks picks the whole blocks, and Backspace or Delete takes them
 * away. A drag inside one block still picks words, which is what marking text needs.
 */

const PARAGRAPHS = ['Alpha line.', '', 'Beta line.', '', 'Gamma line.', '', 'Delta line.', ''].join('\n');
const LIST = ['Intro line.', '', '- One', '- Two', '- Three', '', 'Outro line.', ''].join('\n');

/**
 * How far left of the document a gutter drag starts. The grip and the plus button stand in the
 * first half of the gutter, so a drag has to begin past them.
 */
const GUTTER_X = 55;

function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

function line(page: Page, text: string): Locator {
  return editorBody(page).getByText(text, { exact: true });
}

function litBlocks(page: Page): Locator {
  return editorBody(page).locator('.gd-block-selected');
}

async function seedPage(
  api: ApiClient,
  content: ContentRepo,
  name: string,
  markdown: string,
): Promise<{ path: string; file: string }> {
  const space = await api.createUniqueSpace('blockselect');
  const path = `${space.slug}/${name}`;
  await api.createPage({ path, title: name, markdown });
  return { path, file: await content.waitForPageFile(path) };
}

/** Press the button on one line, drag to another, and let go. */
async function dragBetween(page: Page, from: Locator, to: Locator): Promise<void> {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (start === null || end === null) throw new Error('a line has no box');

  await page.mouse.move(start.x + 4, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 4, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe('selecting whole blocks', () => {
  test('a drag over three lines lights them up, and Backspace takes all three', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'sweep', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();

    await dragBetween(page, line(page, 'Beta line.'), line(page, 'Delta line.'));
    await expect(litBlocks(page)).toHaveCount(3);

    await page.keyboard.press('Backspace');

    // Whole blocks, so nothing of the first or the last is left to fuse into one line.
    await expect(editorBody(page)).toHaveText('Alpha line.');
    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .not.toContain('Beta line.');
  });

  test('a drag beside the lines, in the gutter, picks them too', async ({ api, content, page }) => {
    const seeded = await seedPage(api, content, 'gutter', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    const surface = await editorBody(page).boundingBox();
    const beta = await line(page, 'Beta line.').boundingBox();
    const delta = await line(page, 'Delta line.').boundingBox();
    if (surface === null || beta === null || delta === null) throw new Error('a line has no box');

    await page.mouse.move(surface.x - GUTTER_X, beta.y + 2);
    await page.mouse.down();
    await page.mouse.move(surface.x - GUTTER_X, delta.y + delta.height - 2, { steps: 12 });
    await page.mouse.up();

    await expect(litBlocks(page)).toHaveCount(3);

    await page.keyboard.press('Delete');

    await expect(editorBody(page)).toHaveText('Alpha line.');
  });

  test('a drag inside one line still picks words, so the mark bar comes up', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'words', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    const beta = await line(page, 'Beta line.').boundingBox();
    if (beta === null) throw new Error('the line has no box');

    await page.mouse.move(beta.x + 2, beta.y + beta.height / 2);
    await page.mouse.down();
    await page.mouse.move(beta.x + 28, beta.y + beta.height / 2, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible();
    await expect(litBlocks(page)).toHaveCount(0);
  });

  test('a drag over two items of a list leaves the third one standing', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'items', LIST);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Intro line.')).toBeVisible();

    await dragBetween(page, line(page, 'One'), line(page, 'Two'));
    // The items, not the list around them: the reader never dragged over the third one.
    await expect(litBlocks(page)).toHaveCount(2);

    await page.keyboard.press('Backspace');

    await expect(editorBody(page)).toContainText('Three');
    await expect(editorBody(page)).not.toContainText('One');
    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .toContain('- Three');
  });

  test('Escape gives the blocks back, whole', async ({ api, content, page }) => {
    const seeded = await seedPage(api, content, 'escape', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();

    await dragBetween(page, line(page, 'Beta line.'), line(page, 'Gamma line.'));
    await expect(litBlocks(page)).toHaveCount(2);

    await page.keyboard.press('Escape');
    await expect(litBlocks(page)).toHaveCount(0);

    await page.keyboard.press('Backspace');
    await expect(editorBody(page)).toContainText('Beta line.');
    await expect(editorBody(page)).toContainText('Delta line.');
  });
});
