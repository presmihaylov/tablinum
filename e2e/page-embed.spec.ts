import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The `/page` slash command. It embeds a page that exists, or makes a new one under the open
 * page and embeds that. Either way the embed must name a page the shell can open.
 */

function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

/** The embed drawn in the body: a button that carries the icon and the title of its page. */
function embed(page: Page): Locator {
  return page.locator('.gd-editor-pageembed__link');
}

/** Open the slash menu at the cursor and take the option whose title reads `title`. */
async function runCommand(page: Page, query: string, title: string): Promise<void> {
  // The first paragraph every time: a click in the middle of the surface lands wherever the
  // last command left its blocks, and an embed there would open its page instead.
  await editorBody(page).locator('p').first().click();
  await page.keyboard.press('End');
  // The menu only opens after a space or at the start of a line, so a command needs its own line.
  await page.keyboard.press('Enter');
  await page.keyboard.type(`/${query}`);
  const menu = page.getByRole('listbox', { name: 'Insert block' });
  await expect(menu).toBeVisible();
  // The accessible name of an option holds the hint too, so match the title span alone.
  const exact = new RegExp(`^${title}$`);
  await menu
    .getByRole('option')
    .filter({ has: page.locator('.gd-editor-menu__title', { hasText: exact }) })
    .first()
    .click();
}

/** Name a page in the open picker and take the offer to create it. */
async function createFromPicker(page: Page, title: string): Promise<void> {
  const picker = page.getByRole('dialog', { name: 'Embed a page' });
  await expect(picker).toBeVisible();
  const field = picker.getByRole('textbox', { name: 'Page', exact: true });
  await field.fill(title);
  // The dialog used to clear the field once it was on screen, which lost what was typed.
  await expect(field).toHaveValue(title);
  await picker.getByRole('option', { name: new RegExp(`New page: ${title}`) }).click();
  // The overlay behind the dialog swallows a click, so the next step must wait for it to go.
  await expect(picker).toHaveCount(0);
}

test.describe('page slash command', () => {
  let slug = '';
  let path = '';

  test.beforeEach(async ({ api }) => {
    slug = (await api.createUniqueSpace('embed')).slug;
    path = `${slug}/plan`;
    await api.createPage({ path, title: 'Plan', markdown: 'The work lives below.\n' });
  });

  test('makes a page and embeds one that opens', async ({ page, content }) => {
    await page.goto(`/p/${path}`);
    await expect(editorBody(page)).toContainText('The work lives below.');

    await runCommand(page, 'page', 'Page');
    await createFromPicker(page, 'Rollout');

    const child = `${path}/rollout`;
    await expect(embed(page)).toHaveAttribute('title', child);
    await expect(embed(page)).toContainText('Rollout');

    // The embed must survive the save, else a refresh loses it.
    await expect.poll(async () => (await content.pageFileText(path)) ?? '').toContain(`![[${child}]]`);

    // A reload reads the embed back out of markdown, so it has to parse into a node again.
    await page.reload();
    await expect(embed(page)).toContainText('Rollout');
    await expect(editorBody(page)).not.toContainText('![[');

    await embed(page).click();
    await expect(page).toHaveURL(new RegExp(`/p/${child}$`));
    await expect(page.getByLabel('Page title')).toHaveValue('Rollout');
  });

  test('embeds a page that already exists', async ({ api, page }) => {
    await api.createPage({ path: `${slug}/notes`, title: 'Notes', markdown: 'Kept apart.\n' });
    await page.goto(`/p/${path}`);
    await expect(editorBody(page)).toContainText('The work lives below.');

    await runCommand(page, 'page', 'Page');
    const picker = page.getByRole('dialog', { name: 'Embed a page' });
    await picker.getByRole('textbox', { name: 'Page', exact: true }).fill('Notes');
    // The search is debounced, and "New page: Notes" also reads Notes. Match on the path.
    const found = picker.getByRole('option', { name: `${slug}/notes` });
    await expect(found).toBeVisible();
    await found.click();

    await expect(embed(page)).toContainText('Notes');
    await embed(page).click();
    await expect(page).toHaveURL(new RegExp(`/p/${slug}/notes$`));
  });

  test('keeps the typed title when the picker opens a second time', async ({ content, page }) => {
    await page.goto(`/p/${path}`);
    await expect(editorBody(page)).toContainText('The work lives below.');

    await runCommand(page, 'page', 'Page');
    await createFromPicker(page, 'Rollout');
    // Let the first save land, so the second run starts from a settled page.
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '')
      .toContain(`![[${path}/rollout]]`);

    await runCommand(page, 'page', 'Page');
    await createFromPicker(page, 'Rollout');

    // The second page needs a slug of its own, and the second title must not be wiped by the
    // dialog as it opens. Both embeds prove it.
    await expect(embed(page)).toHaveCount(2);
    // The second run inserts under the first paragraph, so the newer embed is drawn above the
    // older one. Only the pair of targets matters here.
    const titles = await embed(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title')));
    expect(titles.slice().sort()).toEqual([`${path}/rollout`, `${path}/rollout-2`]);
  });

  test('keeps the unsaved text of the parent, with no save conflict', async ({ content, page }) => {
    // A first child turns `plan.md` into `plan/index.md`. The open editor holds the old text, so
    // a save that started before the move must still land, and must not restart as a 409 run.
    const conflicts: string[] = [];
    page.on('response', (response) => {
      if (response.status() === 409) conflicts.push(`${response.request().method()} ${response.url()}`);
    });

    await page.goto(`/p/${path}`);
    await expect(editorBody(page)).toContainText('The work lives below.');

    await editorBody(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Ship on Friday.');
    // No wait here: the save is still debounced when the child is created.
    await runCommand(page, 'page', 'Page');
    await createFromPicker(page, 'Rollout');

    const child = `${path}/rollout`;
    await expect
      .poll(async () => (await content.pageFileText(path)) ?? '')
      .toContain(`![[${child}]]`);
    expect(await content.pageFileText(path)).toContain('Ship on Friday.');
    expect(conflicts).toEqual([]);

    await embed(page).click();
    await expect(page).toHaveURL(new RegExp(`/p/${child}$`));
  });
});
