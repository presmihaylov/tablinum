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

/** The box the pointer paints while it picks blocks. */
function band(page: Page): Locator {
  return page.locator('.gd-block-band');
}

/**
 * Drag in the gutter beside the document, from one line down to another. The button stays
 * down when `hold` is set, so a test may look at the box while it is painted.
 */
async function dragGutter(
  page: Page,
  from: Locator,
  to: Locator,
  hold = false,
): Promise<void> {
  const surface = await editorBody(page).boundingBox();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (surface === null || start === null || end === null) throw new Error('a line has no box');

  await page.mouse.move(surface.x - GUTTER_X, start.y + 2);
  await page.mouse.down();
  await page.mouse.move(surface.x - GUTTER_X, end.y + end.height - 2, { steps: 12 });
  if (hold) return;
  await page.mouse.up();
}

/**
 * Drag the grip beside one line and drop it on another. Chromium needs several moves before
 * it raises a native drag at all, so one `dragTo` is not enough.
 */
async function dragGrip(page: Page, grip: Locator, onto: Locator): Promise<void> {
  const start = await grip.boundingBox();
  const end = await onto.boundingBox();
  if (start === null || end === null) throw new Error('the grip has no box');

  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const to = { x: end.x + end.width / 2, y: end.y + end.height - 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    const ratio = step / 8;
    await page.mouse.move(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
  }
  await page.mouse.up();
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
    await expect(line(page, 'Alpha line.')).toBeVisible();

    await dragGutter(page, line(page, 'Beta line.'), line(page, 'Delta line.'));

    await expect(litBlocks(page)).toHaveCount(3);

    await page.keyboard.press('Delete');

    await expect(editorBody(page)).toHaveText('Alpha line.');
  });

  test('the gutter drag paints a box, and takes it away again', async ({ api, content, page }) => {
    const seeded = await seedPage(api, content, 'band', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();
    await expect(band(page)).toHaveCount(0);

    await dragGutter(page, line(page, 'Beta line.'), line(page, 'Delta line.'), true);

    await expect(band(page)).toBeVisible();
    const box = await band(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(20);
    await expect(litBlocks(page)).toHaveCount(3);

    await page.mouse.up();
    await expect(band(page)).toHaveCount(0);
    // The box goes, the blocks stay: the reader now has a run to move or to delete.
    await expect(litBlocks(page)).toHaveCount(3);
  });

  test('the grip of a marked run moves every line in it', async ({ api, content, page }) => {
    const seeded = await seedPage(api, content, 'move', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();

    await dragGutter(page, line(page, 'Beta line.'), line(page, 'Gamma line.'));
    await expect(litBlocks(page)).toHaveCount(2);

    await line(page, 'Beta line.').hover();
    const grip = page.getByRole('button', { name: 'Block actions' });
    await expect(grip).toBeVisible();
    await dragGrip(page, grip, line(page, 'Delta line.'));

    // Moved, not copied: the two lines stand once, and they stand after Delta.
    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .toContain('Alpha line.\n\nDelta line.\n\nBeta line.\n\nGamma line.');
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
