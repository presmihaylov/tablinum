import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page as BrowserPage } from '@playwright/test';
import { expect, test, uniqueSlug, type ApiClient } from './fixtures';
import { RUN_DIR } from './env';
import { ContentRepo } from './helpers/content';

/**
 * Attachments and workspaces.
 *
 * The editor uploads an image through POST /api/v1/assets and writes the returned
 * `/_assets/<pageId>/<file>` URL into the markdown, so that URL has to answer with the bytes
 * that are on disk. A workspace is a second git repository beside the first one, and the
 * switcher in the sidebar is the only thing in the UI that moves a tab between them.
 */

/** One red pixel. The browser has to decode it, so a text file would not do. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
}

/** Wait until the editor holds the page, so the upload has something to insert into. */
async function openPage(page: BrowserPage, path: string, title: string): Promise<void> {
  await page.goto(`/p/${path}`);
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue(title);
}

/** The slash menu and a drop both end at this input, so driving it is the real upload path. */
async function uploadImage(page: BrowserPage, filename: string): Promise<void> {
  await page
    .getByLabel('Upload an image')
    .setInputFiles({ name: filename, mimeType: 'image/png', buffer: PNG_BYTES });
}

/** The title of the page the sidebar opens on, whatever earlier specs left behind. */
async function homeTitleOf(api: ApiClient): Promise<string> {
  const spaces = await api.tree();
  const first = spaces[0]?.tree[0];
  if (first === undefined) throw new Error('the first workspace has no page to open');
  return first.title;
}

async function createWorkspace(page: BrowserPage, name: string): Promise<WorkspaceRow> {
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New workspace' }).click();

  const dialog = page.getByRole('dialog', { name: 'New workspace' });
  await dialog.getByLabel('Workspace name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();

  // The switcher names the workspace this tab is in, so it is the sign the move happened.
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
  return workspaceRow(page, name);
}

async function switchWorkspace(page: BrowserPage, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('menuitem', { name }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
}

/** The wire record, for the slug the server picked and the directory that goes with it. */
async function workspaceRow(page: BrowserPage, name: string): Promise<WorkspaceRow> {
  const response = await page.request.get('/api/v1/workspaces');
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { workspaces: WorkspaceRow[] };
  const found = body.workspaces.find((one) => one.name === name);
  if (found === undefined) throw new Error(`the server has no workspace called ${name}`);
  return found;
}

/** A workspace the server creates gets its repository beside the content directory. */
function repoOf(workspace: WorkspaceRow): ContentRepo {
  return new ContentRepo(join(RUN_DIR, 'workspaces', workspace.slug));
}

test.describe('attachments and workspaces', () => {
  /** Spaces this test made. Removing them keeps the tree the next spec sees unchanged. */
  let scratchSpaces: string[] = [];

  test.beforeEach(() => {
    scratchSpaces = [];
  });

  // Deleting the pages through the API keeps the index in step; the watcher is not involved.
  test.afterEach(async ({ api, content }) => {
    for (const slug of scratchSpaces) {
      const home = await api.getPage(slug);
      if (home !== null) await api.deletePage(home.id, { recursive: true });
      await content.remove(slug);
    }
  });

  test('an image uploaded in the editor renders in the page', async ({ page, api }) => {
    const space = await api.createUniqueSpace('assets');
    scratchSpaces.push(space.slug);
    const target = await api.createPage({ path: `${space.slug}/gallery`, title: 'Gallery' });
    const filename = `${uniqueSlug('shot')}.png`;

    await openPage(page, target.path, 'Gallery');
    await uploadImage(page, filename);

    const image = page.getByRole('img', { name: filename });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', `/_assets/${target.id}/${filename}`);

    // A broken src still renders an <img>, so ask the browser whether the bytes decoded.
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth), {
        message: 'the browser never decoded the attachment',
      })
      .toBe(1);
  });

  test('the uploaded file is on disk where its URL says, and git tracks it', async ({
    page,
    api,
    content,
  }) => {
    const space = await api.createUniqueSpace('assets');
    scratchSpaces.push(space.slug);
    const target = await api.createPage({ path: `${space.slug}/notes`, title: 'Notes' });
    const filename = `${uniqueSlug('diagram')}.png`;

    await openPage(page, target.path, 'Notes');
    await uploadImage(page, filename);

    const src = await page.getByRole('img', { name: filename }).getAttribute('src');
    expect(src).toBe(`/_assets/${target.id}/${filename}`);

    // The URL is the content-root-relative path of the file, so look for it there.
    const relPath = `_assets/${target.id}/${filename}`;
    await content.waitForFile(relPath);
    expect(await readFile(content.path(relPath))).toEqual(PNG_BYTES);

    await expect
      .poll(() => content.pageFileText(target.path), { message: 'the link never reached the markdown' })
      .toContain(`(/_assets/${target.id}/${filename})`);

    // The autocommit coalesces the upload with the page save, so the subject of the commit is
    // whichever write scheduled it last. That the attachment is committed is the fact.
    await expect
      .poll(() => content.trackedFiles(), { message: 'the attachment was never committed' })
      .toContain(relPath);
  });

  test('a second workspace opens with its own tree and its own repository', async ({ page, api }) => {
    const homeTitle = await homeTitleOf(api);
    await page.goto('/');
    await expect(page.getByRole('treeitem', { name: homeTitle }).first()).toBeVisible();

    const name = uniqueSlug('e2e-ws');
    const workspace = await createWorkspace(page, name);

    // A new workspace starts with one space, "General", and that space's home page.
    await expect(page.getByRole('treeitem', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: homeTitle })).toHaveCount(0);

    const repo = repoOf(workspace);
    await repo.waitForPageFile('general');
    await repo.waitForCommit(`Create workspace ${name}`);
  });

  test('a page made in the second workspace stays out of the first', async ({ page, api, content }) => {
    const homeTitle = await homeTitleOf(api);
    await page.goto('/');
    const name = uniqueSlug('e2e-ws');
    const workspace = await createWorkspace(page, name);

    const title = `Roadmap ${uniqueSlug('x')}`;
    await page.getByRole('button', { name: 'New page' }).click();
    const dialog = page.getByRole('dialog', { name: 'New page' });
    await dialog.getByLabel('Page title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByRole('treeitem', { name: title })).toBeVisible();
    const path = new URL(page.url()).pathname.replace('/p/', '');
    await repoOf(workspace).waitForPageFile(path);

    await switchWorkspace(page, 'Main');

    // The tree belongs to the first workspace again, and the new page is nowhere in it.
    await expect(page.getByRole('treeitem', { name: homeTitle }).first()).toBeVisible();
    await expect(page.getByRole('treeitem', { name: title })).toHaveCount(0);

    expect(await content.pageFile(path)).toBeNull();
    expect((await api.listPages()).map((one) => one.path)).not.toContain(path);
  });
});
