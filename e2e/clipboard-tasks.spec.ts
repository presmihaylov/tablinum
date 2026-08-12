import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient, ContentRepo } from './fixtures';

/**
 * A to-do list copied out of the editor. What the unit tests prove over the clipboard
 * serialiser, this spec proves over the real system clipboard: the HTML another app reads
 * carries one flat `<li>` per item, and pasting it back rebuilds the same list.
 */

const TODOS = [
  '- [ ] Setup and test notifications',
  '- [x] Ship the release',
  '- [ ] Tell the team',
  '',
].join('\n');

function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

function bodyOf(text: string): string {
  const match = /^---\n[\s\S]*?\n---\n\n?/.exec(text);
  if (match === null) throw new Error('the page file carries no frontmatter block');
  return text.slice(match[0].length);
}

async function seedPage(
  api: ApiClient,
  content: ContentRepo,
  name: string,
  markdown: string,
): Promise<{ href: string; file: string }> {
  const space = await api.createUniqueSpace('clipboard');
  const path = `${space.slug}/${name}`;
  await api.createPage({ path, title: name, markdown });
  return { href: `/p/${path}`, file: await content.waitForPageFile(path) };
}

interface Copied {
  html: string;
  text: string;
}

/** Reads both clipboard flavours the browser really holds. */
async function readClipboard(page: Page): Promise<Copied> {
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    if (item === undefined) throw new Error('nothing on the clipboard');
    const read = async (type: string): Promise<string> =>
      item.types.includes(type) ? (await item.getType(type)).text() : '';
    return { html: await read('text/html'), text: await read('text/plain') };
  });
}

/** Selects the whole page body and copies it with the browser's own shortcut. */
async function copyWholeDocument(page: Page): Promise<Copied> {
  await editorBody(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(async () => (await readClipboard(page)).text).toContain('[ ]');
  return readClipboard(page);
}

/** The `<li>` elements of the copied HTML, read back as DOM inside the page. */
async function copiedItems(page: Page, html: string): Promise<Array<{ inner: string; blocks: number }>> {
  return page.evaluate((source: string) => {
    const host = document.createElement('div');
    host.innerHTML = source;
    return Array.from(host.querySelectorAll('li')).map((item) => ({
      inner: item.innerHTML,
      blocks: item.querySelectorAll('p, div, blockquote, h1, h2, h3').length,
    }));
  }, html);
}

test.describe('copying a to-do list', () => {
  test.beforeEach(async ({ context }: { context: BrowserContext }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('the clipboard HTML holds one flat item per to-do', async ({ page, api, content }) => {
    const source = await seedPage(api, content, 'copied', TODOS);

    await page.goto(source.href);
    await expect(editorBody(page).locator('li[data-checked]')).toHaveCount(3);

    const copied = await copyWholeDocument(page);
    const items = await copiedItems(page, copied.html);

    expect(items).toHaveLength(3);
    for (const item of items) {
      // No `<p>` and no `<div>`: those are what an importer reads as a block of its own.
      expect(item.blocks).toBe(0);
      expect(item.inner).toContain('type="checkbox"');
    }
    expect(items[0]?.inner).toContain('Setup and test notifications');
    expect(items[1]?.inner).toContain('checked');
    expect(items[0]?.inner).not.toContain('checked');
  });

  test('the clipboard text holds one markdown line per to-do', async ({ page, api, content }) => {
    const source = await seedPage(api, content, 'copied-text', TODOS);

    await page.goto(source.href);
    await expect(editorBody(page).locator('li[data-checked]')).toHaveCount(3);

    const copied = await copyWholeDocument(page);

    expect(copied.text).toBe(TODOS.trimEnd());
  });

  test('pasting the copy back into tablinum rebuilds the same list', async ({
    page,
    api,
    content,
  }) => {
    const source = await seedPage(api, content, 'round-source', TODOS);
    const target = await seedPage(api, content, 'round-target', '');

    await page.goto(source.href);
    await expect(editorBody(page).locator('li[data-checked]')).toHaveCount(3);
    await copyWholeDocument(page);

    await page.goto(target.href);
    await editorBody(page).click();
    await page.keyboard.press('ControlOrMeta+v');

    // Three to-dos and no loose paragraph beside them.
    await expect(editorBody(page).locator('li[data-checked]')).toHaveCount(3);
    await expect(editorBody(page).locator('> p')).toHaveCount(0);
    await expect
      .poll(async () => bodyOf((await content.read(target.file)) ?? ''), {
        message: 'the pasted page never held the to-do list',
      })
      .toBe(TODOS);
  });
});
