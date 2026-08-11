import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient, ContentRepo } from './fixtures';

/**
 * Two features of the blank room around the document.
 *
 * Dragging over several blocks picks the whole blocks, and Backspace or Delete takes them
 * away. A drag inside one block still picks words, which is what marking text needs.
 *
 * Clicking in that room, without dragging, gives the reader a line to write on. Both work
 * anywhere the shell marks as blank room, which is the whole page beside and below the text.
 */

const PARAGRAPHS = ['Alpha line.', '', 'Beta line.', '', 'Gamma line.', '', 'Delta line.', ''].join('\n');
const LIST = ['Intro line.', '', '- One', '- Two', '- Three', '', 'Outro line.', ''].join('\n');
const TABLE = ['Intro line.', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', ''].join('\n');

/**
 * How far left of the document a gutter drag starts. The grip and the plus button stand in the
 * first half of the gutter, so a drag has to begin past them.
 */
const GUTTER_X = 55;

/**
 * The strip left of the document that the old rule armed in, and nothing wider. A margin drag
 * has to start well outside it, or the test says nothing about the fix.
 */
const OLD_GUTTER = 72;

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

/** The top-level blocks of the document, one locator over all of them. */
function blocks(page: Page): Locator {
  return page.locator('.gd-editor-surface > *');
}

/** A point in the blank room under the last block, where a reader clicks to write on. */
async function underLastBlock(page: Page): Promise<{ x: number; y: number }> {
  const canvas = await page.locator('.editor__canvas').boundingBox();
  const last = await blocks(page).last().boundingBox();
  if (canvas === null || last === null) throw new Error('the page has no box');
  return { x: canvas.x + 200, y: (last.y + last.height + canvas.y + canvas.height) / 2 };
}

/** The bottom edge of a box, so a test can say plainly that it aims past it. */
async function bottomOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`the page has no ${selector}`);
  return box.y + box.height;
}

/**
 * A point in the room the page keeps well under a box, and outside it. `.editor__canvas` ends
 * far above the fold, so a point under it is the blank page a reader actually aims at, and no
 * test that aims inside that box can say anything about the page under it.
 */
async function under(page: Page, selector: string, gap = 60): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  const column = await page.locator('.app-content').boundingBox();
  if (box === null || column === null) throw new Error(`the page has no ${selector}`);
  const y = box.y + box.height + gap;
  expect(y).toBeLessThan(column.y + column.height);
  return { x: box.x + 200, y };
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

/** How far inside the edge of a box a drag starts, so the press never lands on the edge. */
const EDGE = 4;

/**
 * The far edge of the blank column beside the document, left or right. A drag starts there
 * rather than halfway in, so the distance from the document is the whole margin and no change
 * to `--content-measure` or `--sidebar-width` can quietly bring it back inside the old gutter.
 */
async function marginX(page: Page, side: 'left' | 'right'): Promise<number> {
  const column = await page.locator('.app-content').boundingBox();
  if (column === null) throw new Error('the page has no column');
  if (side === 'left') return column.x + EDGE;
  return column.x + column.width - EDGE;
}

/**
 * Drag in the blank column beside the document, from one line down to another. The button stays
 * down when `hold` is set, so a test may look at the box while it is painted.
 */
async function dragMargin(
  page: Page,
  side: 'left' | 'right',
  from: Locator,
  to: Locator,
  hold = false,
): Promise<void> {
  const x = await marginX(page, side);
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (start === null || end === null) throw new Error('a line has no box');

  await page.mouse.move(x, start.y + 2);
  await page.mouse.down();
  await page.mouse.move(x, end.y + end.height - 2, { steps: 12 });
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

  test('a drag out in the margin, well clear of the gutter, paints a box over the lines', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'margin', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();

    // Said out loud, so the test fails rather than quietly stops meaning anything the day
    // the measure or the rail changes width: the drag begins clear outside the old strip.
    const surface = await editorBody(page).boundingBox();
    if (surface === null) throw new Error('the document has no box');
    expect(surface.x - (await marginX(page, 'left'))).toBeGreaterThan(OLD_GUTTER * 2);

    await dragMargin(page, 'left', line(page, 'Beta line.'), line(page, 'Delta line.'), true);

    await expect(band(page)).toBeVisible();
    await expect(litBlocks(page)).toHaveCount(3);

    await page.mouse.up();
    await expect(band(page)).toHaveCount(0);

    await page.keyboard.press('Backspace');
    await expect(editorBody(page)).toHaveText('Alpha line.');
  });

  test('the margin right of the lines picks them the same way', async ({ api, content, page }) => {
    const seeded = await seedPage(api, content, 'margin-right', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();

    await dragMargin(page, 'right', line(page, 'Beta line.'), line(page, 'Delta line.'), true);

    await expect(band(page)).toBeVisible();
    await expect(litBlocks(page)).toHaveCount(3);

    await page.mouse.up();
    await expect(litBlocks(page)).toHaveCount(3);
  });

  test('the handles come up out in the margin, where a margin drag starts', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'margin-handles', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Beta line.')).toBeVisible();

    const beta = await line(page, 'Beta line.').boundingBox();
    if (beta === null) throw new Error('a line has no box');
    const grip = page.getByRole('button', { name: 'Block actions' });

    // The band and the handles answer one question, so a reader never picks a run of blocks
    // in a place that shows no grip. Both margins are far outside the old 72px gutter.
    for (const side of ['left', 'right'] as const) {
      await page.mouse.move(await marginX(page, side), beta.y + 2);
      await expect(grip).toBeVisible();
    }
  });

  test('a drag up from under the last line picks the lines it crosses', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'below', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();

    const canvas = await page.locator('.editor__canvas').boundingBox();
    const gamma = await line(page, 'Gamma line.').boundingBox();
    if (canvas === null || gamma === null) throw new Error('the page has no box');

    // Under the last line, inside the blank room the editor keeps there.
    await page.mouse.move(canvas.x + 40, canvas.y + canvas.height - 20);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 40, gamma.y + 2, { steps: 12 });

    await expect(band(page)).toBeVisible();
    await expect(litBlocks(page)).toHaveCount(2);
    await page.mouse.up();

    await page.keyboard.press('Delete');
    await expect(editorBody(page)).not.toContainText('Gamma line.');
    await expect(editorBody(page)).not.toContainText('Delta line.');
  });

  test('a drag that starts on a line paints the box once it reaches the next one', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'onto', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    const beta = await line(page, 'Beta line.').boundingBox();
    const delta = await line(page, 'Delta line.').boundingBox();
    if (beta === null || delta === null) throw new Error('a line has no box');

    await page.mouse.move(beta.x + 20, beta.y + beta.height / 2);
    await page.mouse.down();
    await page.mouse.move(beta.x + 20, delta.y + delta.height - 2, { steps: 12 });

    // The box and the lit lines are both up while the button is still down.
    await expect(band(page)).toBeVisible();
    await expect(litBlocks(page)).toHaveCount(3);

    await page.mouse.up();
    await expect(band(page)).toHaveCount(0);
    await expect(litBlocks(page)).toHaveCount(3);
  });

  test('the sidebar keeps its own press, so the margin drag never reaches it', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'sidebar', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();

    const rail = await page.locator('.sidebar').boundingBox();
    const beta = await line(page, 'Beta line.').boundingBox();
    const delta = await line(page, 'Delta line.').boundingBox();
    if (rail === null || beta === null || delta === null) throw new Error('the page has no box');

    await page.mouse.move(rail.x + rail.width / 2, beta.y + 2);
    await page.mouse.down();
    await page.mouse.move(rail.x + rail.width / 2, delta.y + delta.height, { steps: 12 });
    await page.mouse.up();

    await expect(band(page)).toHaveCount(0);
    await expect(litBlocks(page)).toHaveCount(0);
  });

  test('a run picked from the margin still moves with the grip', async ({ api, content, page }) => {
    const seeded = await seedPage(api, content, 'margin-move', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();

    await dragMargin(page, 'left', line(page, 'Beta line.'), line(page, 'Gamma line.'));
    await expect(litBlocks(page)).toHaveCount(2);

    await line(page, 'Beta line.').hover();
    const grip = page.getByRole('button', { name: 'Block actions' });
    await expect(grip).toBeVisible();
    await dragGrip(page, grip, line(page, 'Delta line.'));

    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .toContain('Alpha line.\n\nDelta line.\n\nBeta line.\n\nGamma line.');
  });

  test('a shift click past a block boundary picks the whole blocks as well', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'shift', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Alpha line.')).toBeVisible();
    const beta = await line(page, 'Beta line.').boundingBox();
    const delta = await line(page, 'Delta line.').boundingBox();
    if (beta === null || delta === null) throw new Error('a line has no box');

    // The box turns a shift click down, so the release is the only thing that widens it.
    await page.mouse.click(beta.x + 20, beta.y + beta.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.click(delta.x + 20, delta.y + delta.height / 2);
    await page.keyboard.up('Shift');

    await expect(band(page)).toHaveCount(0);
    await expect(litBlocks(page)).toHaveCount(3);
  });

  test('a drag out of a line and back into it still ends on the words', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'back', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    const beta = await line(page, 'Beta line.').boundingBox();
    const delta = await line(page, 'Delta line.').boundingBox();
    if (beta === null || delta === null) throw new Error('a line has no box');

    // Down past the last line and back up into the one it started on. A reader overshoots a
    // short line all the time, and what they let go on is a run of words in that one line.
    await page.mouse.move(beta.x + 2, beta.y + beta.height / 2);
    await page.mouse.down();
    await page.mouse.move(beta.x + 2, delta.y + delta.height - 2, { steps: 8 });
    await page.mouse.move(beta.x + 60, beta.y + beta.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(litBlocks(page)).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible();
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

/**
 * The blank page under the document. It is not one box: `.editor__canvas` ends where the
 * editor stops asking for room, and the column the page stands in carries on to the fold. A
 * database ends the canvas after one line, so nearly the whole window is this room.
 */
test.describe('the room below the document', () => {
  test('a click under a table writes on a fresh line, with no Enter first', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'under-table', TABLE);

    await page.goto(`/p/${seeded.path}`);
    await expect(editorBody(page).locator('table')).toBeVisible();
    await expect(blocks(page)).toHaveCount(2);

    const spot = await underLastBlock(page);
    await page.mouse.click(spot.x, spot.y);
    await page.keyboard.type('After the table.');

    // No gap cursor is left behind, and the typed line stands under the table on its own.
    await expect(page.locator('.ProseMirror-gapcursor')).toHaveCount(0);
    await expect(blocks(page)).toHaveCount(3);
    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .toContain('After the table.');
  });

  test('a click under a line of words writes on a fresh line under it', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'under-words', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Delta line.')).toBeVisible();

    const spot = await underLastBlock(page);
    await page.mouse.click(spot.x, spot.y);
    await page.keyboard.type('Epsilon line.');

    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .toContain('Delta line.\n\nEpsilon line.');
  });

  test('a second click under an empty last line adds no second one', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'under-empty', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Delta line.')).toBeVisible();
    await expect(blocks(page)).toHaveCount(4);

    // The first click makes the empty line; every click after it only puts the caret back.
    const first = await underLastBlock(page);
    await page.mouse.click(first.x, first.y);
    await expect(blocks(page)).toHaveCount(5);

    for (let again = 0; again < 3; again += 1) {
      const spot = await underLastBlock(page);
      await page.mouse.click(spot.x, spot.y);
    }
    await expect(blocks(page)).toHaveCount(5);

    await page.keyboard.type('Epsilon line.');
    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .toContain('Delta line.\n\nEpsilon line.');
  });

  test('a drag from under the last line paints a box and adds no line', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'under-drag', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(blocks(page)).toHaveCount(4);

    const spot = await underLastBlock(page);
    const gamma = await line(page, 'Gamma line.').boundingBox();
    if (gamma === null) throw new Error('a line has no box');

    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x, gamma.y + 2, { steps: 12 });
    await expect(band(page)).toBeVisible();
    await page.mouse.up();

    await expect(litBlocks(page)).toHaveCount(2);
    // The drag picked blocks; it never asked for a new line.
    await expect(blocks(page)).toHaveCount(4);
  });

  test('a click past the bottom of the canvas box writes a line all the same', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'past-canvas', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(line(page, 'Delta line.')).toBeVisible();

    const spot = await under(page, '.editor__canvas');
    // Well past the canvas box, which the old rule read its bound from: the bottom strip of
    // the window used to answer nothing at all, not even a gap cursor.
    expect(spot.y).toBeGreaterThan((await bottomOf(page, '.editor__canvas')) + 24);

    await page.mouse.click(spot.x, spot.y);
    await page.keyboard.type('Epsilon line.');

    await expect
      .poll(async () => (await content.pageFileText(seeded.path)) ?? '')
      .toContain('Delta line.\n\nEpsilon line.');
  });

  test('a drag up from past the bottom of the canvas box picks the lines it crosses', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPage(api, content, 'past-canvas-drag', PARAGRAPHS);

    await page.goto(`/p/${seeded.path}`);
    await expect(blocks(page)).toHaveCount(4);

    const spot = await under(page, '.editor__canvas');
    expect(spot.y).toBeGreaterThan((await bottomOf(page, '.editor__canvas')) + 24);
    const gamma = await line(page, 'Gamma line.').boundingBox();
    if (gamma === null) throw new Error('a line has no box');

    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x, gamma.y + 2, { steps: 12 });

    await expect(band(page)).toBeVisible();
    await expect(litBlocks(page)).toHaveCount(2);
    await page.mouse.up();

    // The drag picked blocks; it never asked for a new line.
    await expect(blocks(page)).toHaveCount(4);
  });

  test('a click under a database gives a line to write on, well past its one-line canvas', async ({
    api,
    content,
    page,
  }) => {
    const space = await api.createUniqueSpace('blockselect');
    const path = `${space.slug}/tasks`;
    const created = await api.createPage({
      path,
      title: 'Tasks',
      markdown: 'The plan lives below.\n',
    });
    await api.makeDatabase(created.id);
    await content.waitForPageFile(path);

    await page.goto(`/p/${path}`);
    await expect(page.getByTestId('db-table')).toBeVisible();
    await expect(blocks(page)).toHaveCount(1);

    // A database shrinks the canvas to a single line, so everything under the table used to
    // be dead: hundreds of pixels of page that answered no click.
    const spot = await under(page, '.page-shell');
    expect(spot.y).toBeGreaterThan((await bottomOf(page, '.editor__canvas')) + 24);

    await page.mouse.click(spot.x, spot.y);
    await page.keyboard.type('Written under the table.');

    await expect(blocks(page)).toHaveCount(2);
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '')
      .toContain('The plan lives below.\n\nWritten under the table.');
  });
});
