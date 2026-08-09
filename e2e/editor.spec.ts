import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ApiClient, ContentRepo } from './fixtures';

/**
 * The markdown editor, driven through the real UI. It mirrors apps/web/test/editor:
 * what the unit tests prove over the serializer, this spec proves over the file on disk.
 */

/** Every construct the journey has to keep, each one taken from the editor's own corpus. */
const RICH = [
  '# Release checklist',
  '',
  'Ship **now**, not *later*, and read the [handbook](https://example.com/handbook).',
  '',
  '## Steps',
  '',
  '- Freeze the branch',
  '- Tag the release',
  '  - Push the tag',
  '',
  '1. Announce',
  '2. Celebrate',
  '',
  '```sh',
  'git tag -a v1.0.0',
  '```',
  '',
  'Last line.',
  '',
].join('\n');

/**
 * ProseMirror's editable box is a plain `div`, so it carries no role and no label; the class
 * the editor puts on it is the same handle the unit tests use.
 */
function editorBody(page: Page): Locator {
  return page.locator('.gd-editor-surface');
}

function pageHref(path: string): string {
  return `/p/${path}`;
}

/** The markdown under the frontmatter block. The block itself is the server's, not the editor's. */
function bodyOf(text: string): string {
  const match = /^---\n[\s\S]*?\n---\n\n?/.exec(text);
  if (match === null) throw new Error('the page file carries no frontmatter block');
  return text.slice(match[0].length);
}

/** Poll the file until its body is the expected markdown. The save is debounced, so this waits. */
async function expectBody(content: ContentRepo, file: string, markdown: string): Promise<void> {
  await expect
    .poll(async () => bodyOf((await content.read(file)) ?? ''), {
      message: `${file} never held the expected markdown`,
    })
    .toBe(markdown);
}

/** A page nothing else in the run shares, plus the file that holds it. */
async function seedPage(
  api: ApiClient,
  content: ContentRepo,
  name: string,
  markdown: string,
): Promise<{ path: string; file: string }> {
  const space = await api.createUniqueSpace('editor');
  const path = `${space.slug}/${name}`;
  await api.createPage({ path, title: name, markdown });
  return { path, file: await content.waitForPageFile(path) };
}

/** Put the caret at the end of the block that holds `text`. */
async function caretAfter(page: Page, text: string): Promise<void> {
  await editorBody(page).getByText(text, { exact: true }).click();
  await page.keyboard.press('End');
}

test.describe('the markdown editor', () => {
  test('typing markdown syntax writes that markdown to disk', async ({ page, api, content }) => {
    const { path, file } = await seedPage(api, content, 'typed', '');

    await page.goto(pageHref(path));
    await editorBody(page).click();

    await page.keyboard.type('# Release notes');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Ship **now**, not *later*.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    await page.keyboard.press('Enter');
    // A second Enter on the empty item leaves the list.
    await page.keyboard.press('Enter');
    // The space after the language closes the fence rule.
    await page.keyboard.type('```sh ');
    await page.keyboard.type('ls -la');

    await expect(editorBody(page).getByRole('heading', { name: 'Release notes' })).toBeVisible();

    await expectBody(
      content,
      file,
      [
        '# Release notes',
        '',
        'Ship **now**, not *later*.',
        '',
        '- alpha',
        '- beta',
        '',
        '```sh',
        'ls -la',
        '```',
        '',
      ].join('\n'),
    );
  });

  test('the link button writes a markdown link', async ({ page, api, content }) => {
    const { path, file } = await seedPage(api, content, 'linked', 'The deploy handbook\n');

    await page.goto(pageHref(path));
    await caretAfter(page, 'The deploy handbook');
    // The page holds one paragraph, so select all is exactly the text the link goes on.
    await page.keyboard.press('ControlOrMeta+a');

    const bar = page.getByRole('toolbar', { name: 'Text formatting' });
    await bar.getByRole('button', { name: 'Link' }).click();
    await bar.getByLabel('Link address').fill('https://example.com/handbook');
    await bar.getByRole('button', { name: 'Apply' }).click();

    await expect(editorBody(page).getByRole('link', { name: 'The deploy handbook' })).toHaveAttribute(
      'href',
      'https://example.com/handbook',
    );
    await expectBody(content, file, '[The deploy handbook](https://example.com/handbook)\n');
  });

  test('opening a page and saving it does not change one byte of the file', async ({
    page,
    api,
    content,
  }) => {
    const space = await api.createUniqueSpace('editor');
    const path = `${space.slug}/untouched`;
    await api.createPage({ path, title: 'Untouched', markdown: RICH });
    await api.createPage({ path: `${space.slug}/elsewhere`, title: 'Elsewhere', markdown: 'Away.\n' });
    const file = await content.waitForPageFile(path);
    const before = await content.read(file);

    const patched: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/api/v1/pages/')) {
        patched.push(request.url());
      }
    });

    await page.goto(pageHref(path));
    await expect(editorBody(page).getByRole('heading', { name: 'Release checklist' })).toBeVisible();
    await editorBody(page).click();
    await page.keyboard.press('ControlOrMeta+s');

    // Leaving the page flushes the pending save, so anything queued has gone out by now.
    await page.getByRole('navigation', { name: 'Pages' }).getByText('Elsewhere', { exact: true }).click();
    await expect(page.getByLabel('Page title')).toHaveValue('Elsewhere');

    expect(patched).toEqual([]);
    expect(await content.read(file)).toBe(before);
    // A page that is only read must leave nothing for git to commit.
    await content.waitForCleanTree();
  });

  test('headings, bold, italic, links, code blocks and lists survive a save', async ({
    page,
    api,
    content,
  }) => {
    const { path, file } = await seedPage(api, content, 'survives', RICH);

    await page.goto(pageHref(path));
    const body = editorBody(page);

    // Everything the file holds is on screen as its own node, not as literal syntax.
    await expect(body.getByRole('heading', { name: 'Release checklist', level: 1 })).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Steps', level: 2 })).toBeVisible();
    await expect(body.locator('strong')).toHaveText('now');
    await expect(body.locator('em')).toHaveText('later');
    await expect(body.getByRole('link', { name: 'handbook' })).toBeVisible();
    await expect(body.locator('ul li > p')).toHaveText([
      'Freeze the branch',
      'Tag the release',
      'Push the tag',
    ]);
    await expect(body.locator('ul ul li > p')).toHaveText(['Push the tag']);
    await expect(body.locator('ol li > p')).toHaveText(['Announce', 'Celebrate']);
    await expect(body.locator('pre')).toContainText('git tag -a v1.0.0');

    // One new paragraph is the whole edit; every other line must come back untouched.
    await caretAfter(page, 'Last line.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Added by the test.');

    await expectBody(content, file, `${RICH}\nAdded by the test.\n`);
  });

  test('undo and redo run the change back through the file', async ({ page, api, content }) => {
    const source = 'The quick brown fox.\n';
    const { path, file } = await seedPage(api, content, 'undone', source);

    await page.goto(pageHref(path));
    await caretAfter(page, 'The quick brown fox.');
    await page.keyboard.type(' It jumped.');
    await expectBody(content, file, 'The quick brown fox. It jumped.\n');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(editorBody(page)).toHaveText('The quick brown fox.');
    // The undone edit leaves the markdown exactly as it was written, byte for byte.
    await expectBody(content, file, source);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expectBody(content, file, 'The quick brown fox. It jumped.\n');
  });

  test('switching pages does not leak content between them', async ({ page, api, content }) => {
    const space = await api.createUniqueSpace('editor');
    const alpha = `${space.slug}/alpha`;
    const beta = `${space.slug}/beta`;
    await api.createPage({ path: alpha, title: 'Alpha', markdown: 'Alpha body.\n' });
    await api.createPage({ path: beta, title: 'Beta', markdown: 'Beta body.\n' });
    const alphaFile = await content.waitForPageFile(alpha);
    const betaFile = await content.waitForPageFile(beta);

    const tree = page.getByRole('navigation', { name: 'Pages' });
    await page.goto(pageHref(alpha));
    await caretAfter(page, 'Alpha body.');
    await page.keyboard.type(' One.');

    await tree.getByText('Beta', { exact: true }).click();
    await expect(page.getByLabel('Page title')).toHaveValue('Beta');
    await expect(editorBody(page)).toHaveText('Beta body.');
    await caretAfter(page, 'Beta body.');
    await page.keyboard.type(' Two.');

    await tree.getByText('Alpha', { exact: true }).click();
    await expect(page.getByLabel('Page title')).toHaveValue('Alpha');
    await expect(editorBody(page)).toHaveText('Alpha body. One.');

    await expectBody(content, alphaFile, 'Alpha body. One.\n');
    await expectBody(content, betaFile, 'Beta body. Two.\n');
  });
});
