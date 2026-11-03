import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient, ContentRepo } from './fixtures';

/**
 * `->` becomes `→` while it is typed, in every editing surface, and it stays that way over a
 * reload. What the unit tests prove over the schema, this spec proves over the file on disk.
 *
 * The plain fields matter twice over here. jsdom ships no `execCommand`, so a unit test can only
 * reach the fallback edit; a real browser takes the `execCommand` path, and only this spec runs it.
 */

const ARROW = '→';

/** ProseMirror's editable box is a plain `div`, so the class is the handle every spec uses. */
function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

function panel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Comments' });
}

function commentsButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Comments, \d+ open$/ });
}

/** The markdown under the frontmatter block. The block itself is the server's. */
function bodyOf(text: string): string {
  const match = /^---\n[\s\S]*?\n---\n\n?/.exec(text);
  if (match === null) throw new Error('the page file carries no frontmatter block');
  return text.slice(match[0].length);
}

async function expectBody(content: ContentRepo, file: string, markdown: string): Promise<void> {
  await expect
    .poll(async () => bodyOf((await content.read(file)) ?? ''), {
      message: `${file} never held the expected markdown`,
    })
    .toBe(markdown);
}

async function seedPage(
  api: ApiClient,
  content: ContentRepo,
  name: string,
  markdown: string,
): Promise<{ path: string; href: string; file: string }> {
  const space = await api.createUniqueSpace('arrow');
  const path = `${space.slug}/${name}`;
  await api.createPage({ path, title: name, markdown });
  return { path, href: `/p/${path}`, file: await content.waitForPageFile(path) };
}

test.describe('the arrow rule', () => {
  test('rewrites "->" in the page body and keeps it over a reload', async ({
    page,
    api,
    content,
  }) => {
    const seeded = await seedPage(api, content, 'body', '');

    await page.goto(seeded.href);
    await editorBody(page).click();
    await page.keyboard.type('Ship it -> today');

    await expect(editorBody(page)).toHaveText(`Ship it ${ARROW} today`);
    await expectBody(content, seeded.file, `Ship it ${ARROW} today\n`);

    await page.reload();
    await expect(editorBody(page)).toHaveText(`Ship it ${ARROW} today`);
  });

  test('gives the typed "->" back on undo, and redo has nothing to give back', async ({
    page,
    api,
    content,
  }) => {
    const seeded = await seedPage(api, content, 'undone', '');

    await page.goto(seeded.href);
    await editorBody(page).click();
    await page.keyboard.type('Ship it ->');
    await expect(editorBody(page)).toHaveText(`Ship it ${ARROW}`);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(editorBody(page)).toHaveText('Ship it ->');

    // Taking an input rule back is an ordinary edit, and an ordinary edit closes the redo branch.
    // The press must not reach the undo binding either, which is what `UndoRedo` guards.
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editorBody(page)).toHaveText('Ship it ->');
  });

  test('rewrites "->" in the page title and writes it to the file', async ({
    page,
    api,
    content,
  }) => {
    const seeded = await seedPage(api, content, 'titled', 'The plan lives below.\n');

    await page.goto(seeded.href);
    const title = page.getByLabel('Page title');
    await title.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' -> done');

    await expect(title).toHaveValue(`titled ${ARROW} done`);
    await expect
      .poll(async () => (await content.read(seeded.file)) ?? '', {
        message: 'the title never reached the page file',
      })
      .toContain(`titled ${ARROW} done`);
  });

  test('leaves pasted "->" exactly as it arrived', async ({ page, context, api, content }) => {
    // A page may only fill the clipboard once it has the right.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const seeded = await seedPage(api, content, 'pasted', '');

    await page.goto(seeded.href);
    await editorBody(page).click();
    // The clipboard is filled from the page, so the paste is the browser's own.
    await page.evaluate(() => navigator.clipboard.writeText('see -> the plan'));
    await page.keyboard.press('ControlOrMeta+v');

    await expect(editorBody(page)).toHaveText('see -> the plan');
    await expectBody(content, seeded.file, 'see -> the plan\n');

    await commentsButton(page).click();
    await panel(page).getByRole('button', { name: 'Comment on the page' }).click();
    const field = panel(page).getByLabel('Write a comment');
    await field.click();
    await page.keyboard.press('ControlOrMeta+v');

    await expect(field).toHaveValue('see -> the plan');
  });

  test('leaves "->" alone in a code block', async ({ page, api, content }) => {
    const seeded = await seedPage(api, content, 'code', '');

    await page.goto(seeded.href);
    await editorBody(page).click();
    // The space after the language closes the fence rule.
    await page.keyboard.type('```js ');
    await page.keyboard.type('const next = a -> b;');

    await expectBody(content, seeded.file, '```js\nconst next = a -> b;\n```\n');
  });

  test('leaves "->" alone in a mermaid block', async ({ page, api, content }) => {
    const source = 'graph TD\n  A[Start]';
    const seeded = await seedPage(api, content, 'mermaid', `\`\`\`mermaid\n${source}\n\`\`\`\n`);

    await page.goto(seeded.href);
    // A click on the picture opens the source and puts the caret in it.
    await page.locator('.gd-editor-mermaid').getByLabel('Mermaid diagram').click();
    // The click opens the source through `editor.chain().focus()`, and Tiptap defers the real
    // `view.focus()` into a `requestAnimationFrame`. `data-source` only says "open" once the
    // editor reports focus, so this is the wait for the caret, not just for the box.
    await expect(page.locator('.gd-editor-mermaid')).toHaveAttribute('data-source', 'open');
    await page.keyboard.press('End');
    // Slowly: the block redraws itself between keystrokes.
    await page.keyboard.type('->B[End]', { delay: 80 });

    await expectBody(content, seeded.file, '```mermaid\ngraph TD\n  A[Start]->B[End]\n```\n');
  });

  test('rewrites "->" in a comment and keeps it over a reload', async ({ page, api, content }) => {
    const seeded = await seedPage(api, content, 'commented', 'Run the pipeline every Friday.\n');

    await page.goto(seeded.href);
    await expect(editorBody(page)).toHaveText('Run the pipeline every Friday.');

    await commentsButton(page).click();
    await panel(page).getByRole('button', { name: 'Comment on the page' }).click();

    // Typed one character at a time, because a rewrite hangs off each keystroke.
    const field = panel(page).getByLabel('Write a comment');
    await field.pressSequentially('move it -> Tuesday');
    await expect(field).toHaveValue(`move it ${ARROW} Tuesday`);

    await panel(page).getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(panel(page).getByText(`move it ${ARROW} Tuesday`)).toBeVisible();

    await page.reload();
    await commentsButton(page).click();
    await expect(panel(page).getByText(`move it ${ARROW} Tuesday`)).toBeVisible();
  });

  test('rewrites "->" in a database cell and in the filter that has to match it', async ({
    page,
    api,
    content,
  }) => {
    const space = await api.createUniqueSpace('arrow');
    const path = `${space.slug}/grid`;
    const created = await api.createPage({ path, title: 'Grid', markdown: '' });
    await api.makeDatabase(created.id);
    const file = await content.waitForPageFile(path);

    await page.goto(`/p/${path}`);
    const grid = page.getByTestId('db-table');
    await expect(grid).toBeVisible();

    await grid.getByRole('button', { name: 'New', exact: true }).first().click();
    const title = grid.getByLabel('Row title').first();
    await expect(title).toBeVisible();

    const notes = grid.getByLabel('Notes').first();
    await notes.click();
    await notes.pressSequentially('ours -> theirs');
    await expect(notes).toHaveValue(`ours ${ARROW} theirs`);
    await notes.press('Enter');

    await expect
      .poll(async () => (await content.read(file)) ?? '', {
        message: 'the cell never reached the database page',
      })
      .toContain(`ours ${ARROW} theirs`);

    // The cell holds `→`, so the box a person filters with has to be able to hold one too.
    const database = page.getByRole('region', { name: 'Database' });
    await database.getByRole('button', { name: /^Filter/ }).click();
    await database.getByRole('button', { name: /Add a filter/ }).click();
    await database.getByLabel('Filter property').selectOption({ label: 'Notes' });

    // The panel opens on `Status`, whose value is picked from a list, and the swap for a box to
    // type in waits on the save. `textbox` is the box and never the list it replaces.
    const value = database.getByRole('textbox', { name: 'Filter value' });
    await expect(value).toBeVisible();
    await value.click();
    await value.pressSequentially('ours -> theirs');
    await expect(value).toHaveValue(`ours ${ARROW} theirs`);
  });
});
