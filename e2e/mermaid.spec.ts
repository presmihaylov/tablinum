import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient } from './fixtures';

/**
 * Mermaid diagrams in the editor. The syntax check runs on a quiet period, so a diagram
 * that is half written never draws a red line under the block while the keys are landing.
 */

const SOURCE = 'graph TD\n  A[Start] --> B[End]';
const PAGE = `Intro\n\n\`\`\`mermaid\n${SOURCE}\n\`\`\`\n`;

const block = (page: Page): Locator => page.locator('.gd-editor-mermaid');
const figure = (page: Page): Locator => page.locator('.gd-editor-mermaid__figure svg');
const errorLine = (page: Page): Locator => page.locator('.gd-editor-mermaid__error');

async function seed(api: ApiClient): Promise<string> {
  const space = await api.createUniqueSpace('mermaid');
  const path = `${space.slug}/diagram`;
  await api.createPage({ path, title: 'Diagram', markdown: PAGE });
  return path;
}

test.describe('mermaid diagrams', () => {
  test('draws the fence and reports a break only once the typing stops', async ({ page, api }) => {
    const path = await seed(api);

    await page.goto(`/p/${path}`);
    await expect(figure(page)).toBeVisible();
    await expect(errorLine(page)).toHaveCount(0);

    // A click on the picture opens the source and puts the caret in it.
    await block(page).getByLabel('Mermaid diagram').click();
    await expect(block(page)).toHaveAttribute('data-source', 'open');

    await page.keyboard.press('End');
    await page.keyboard.type(' {{');

    await expect(errorLine(page)).toHaveCount(1);
    // The last good picture stays up under the line, so the block never goes blank.
    await expect(figure(page)).toBeVisible();

    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    await expect(errorLine(page)).toHaveCount(0);
  });
});
