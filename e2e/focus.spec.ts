import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient } from './fixtures';

/**
 * What a click somewhere else has to undo. A widget that stays lit after the pointer has left
 * reads as focus that never moved, which is the complaint this spec pins down.
 */

const LINE = 'Run the pipeline every Friday.';
const DIAGRAM = '![plan](/_assets/none/plan.excalidraw.svg)';

function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

function panel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Comments' });
}

async function seedPage(api: ApiClient, name: string, markdown: string): Promise<string> {
  const space = await api.createUniqueSpace('focus');
  const path = `${space.slug}/${name}`;
  await api.createPage({ path, title: name, markdown });
  return `/p/${path}`;
}

/** The painted background of the selected node, which is what "lit up" means here. */
async function selectedBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const node = document.querySelector('.ProseMirror-selectednode');
    return node === null ? '(none)' : getComputedStyle(node).backgroundColor;
  });
}

/** Transparent in every browser spelling. */
function isClear(color: string): boolean {
  return color === 'rgba(0, 0, 0, 0)' || color === 'transparent';
}

test.describe('focus leaves on a click somewhere else', () => {
  test('a diagram stops being lit once the caret goes elsewhere', async ({ page, api }) => {
    const href = await seedPage(api, 'diagram', `Some words.\n\n${DIAGRAM}\n\nMore words.\n`);

    await page.goto(href);
    await expect(editorBody(page)).toContainText('Some words.');

    await page.locator('.gd-editor-diagram').click();
    expect(isClear(await selectedBackground(page))).toBe(false);

    // The meta rail is outside the editable box, so this is the click that used to change nothing.
    await page.locator('.pagemeta').first().click({ position: { x: 5, y: 5 } });
    await expect(editorBody(page)).not.toHaveClass(/ProseMirror-focused/);
    expect(isClear(await selectedBackground(page))).toBe(true);
  });

  test('a comment thread leaves the focus on a click in the text', async ({ page, api }) => {
    const href = await seedPage(api, 'thread', `${LINE}\n\nA second line to click on.\n`);

    await page.goto(href);
    await expect(editorBody(page)).toContainText(LINE);

    // Comment on the first line through the block menu, which is the shortest way in.
    await editorBody(page).locator('p', { hasText: LINE }).hover();
    await page.getByRole('button', { name: 'Block actions' }).click();
    await page.getByRole('menuitem', { name: 'Comment' }).click();
    await panel(page).getByLabel('Write a comment').fill('Is Friday still right?');
    await panel(page).getByRole('button', { name: 'Comment', exact: true }).click();

    await expect(panel(page).locator('.comments__thread--active')).toHaveCount(1);
    await expect(editorBody(page).locator('.gd-comment--active')).toHaveCount(1);

    await editorBody(page).locator('p', { hasText: 'A second line to click on.' }).click();

    await expect(panel(page).locator('.comments__thread--active')).toHaveCount(0);
    await expect(editorBody(page).locator('.gd-comment--active')).toHaveCount(0);
    // The thread itself is untouched: only the focus moved.
    await expect(panel(page).getByText('Is Friday still right?')).toBeVisible();
  });
});
