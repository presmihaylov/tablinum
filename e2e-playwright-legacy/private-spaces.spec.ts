import type { Locator, Page } from '@playwright/test';
import { expect, test, uniqueSlug, type ApiClient, type ContentRepo } from './fixtures';
import { newPageFromPalette } from './palette';
import { pageTree } from './sidebar';

/**
 * A private space belongs to one person. Its files stay on disk but never enter git, so a
 * push cannot make them public. The person who owns it still works with it as usual.
 */

interface Seeded {
  slug: string;
  path: string;
  file: string;
}

const SECRET = 'The pay review lands on Tuesday.';

/** The Private bucket of the sidebar, which holds every space the person owns alone. */
function privateBucket(page: Page): Locator {
  return page.getByRole('region', { name: 'Private', exact: true });
}

/** The row of a page inside a bucket. The title span is the only part the row alone owns. */
function row(bucket: Locator, title: string): Locator {
  return bucket.getByText(title, { exact: true }).locator('..');
}

/** A private space with one page written into it, already committed. */
async function seedPrivate(api: ApiClient, content: ContentRepo): Promise<Seeded> {
  const slug = uniqueSlug('vault');
  const space = await api.createSpace({ slug, name: 'Vault', private: true });
  expect(space.owner).toBeTruthy();

  const page = await api.createPage({
    path: `${slug}/salary`,
    title: 'Salary',
    markdown: `${SECRET}\n`,
  });
  await content.waitForCleanTree();

  return { slug, path: page.path, file: await content.waitForPageFile(page.path) };
}

test.describe('private spaces', () => {
  test('keeps every file of the space out of git', async ({ api, content }) => {
    const seeded = await seedPrivate(api, content);
    await api.commit('docs: e2e private space');

    // On disk, so the owner keeps working with it.
    expect(await content.read(seeded.file)).toContain(SECRET);

    const tracked = await content.trackedFiles();
    expect(tracked.filter((file) => file.startsWith(`${seeded.slug}/`))).toEqual([]);
    // Excluded, not merely uncommitted: git does not even see it as a change to make.
    expect(await content.dirtyFiles()).toEqual([]);
    expect(await content.read('.git/info/exclude')).toContain(`/${seeded.slug}/`);
  });

  test('still commits a public page written in the same window', async ({ api, content }) => {
    const seeded = await seedPrivate(api, content);
    const open = await api.createUniqueSpace('open');
    await api.createPage({ path: `${open.slug}/notes`, title: 'Notes', markdown: 'Everybody reads this.\n' });
    await content.waitForCleanTree();

    const tracked = await content.trackedFiles();
    expect(tracked).toContain(`${open.slug}/notes.md`);
    expect(tracked.filter((file) => file.startsWith(`${seeded.slug}/`))).toEqual([]);
  });

  test('shows the space to the person who owns it, in the Private bucket', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPrivate(api, content);

    await page.goto(`/p/${seeded.path}`);
    await expect(page.getByLabel('Page title')).toHaveValue('Salary');

    await expect(row(privateBucket(page), 'Vault')).toBeVisible();
    // The Spaces bucket is what the whole workspace reads, so nothing private may show there.
    await expect(pageTree(page).getByText('Vault', { exact: true })).toHaveCount(0);
  });

  test('folds the Private bucket away and remembers it over a reload', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPrivate(api, content);
    await page.goto(`/p/${seeded.path}`);

    const toggle = privateBucket(page).getByRole('button', { name: 'Private', exact: true });
    await expect(row(privateBucket(page), 'Vault')).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(privateBucket(page).getByText('Vault', { exact: true })).toHaveCount(0);

    await page.reload();

    await expect(
      privateBucket(page).getByRole('button', { name: 'Private', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  test('creates a space from the header of the bucket, and git never tracks it', async ({
    api,
    content,
    page,
  }) => {
    await page.goto('/');
    await expect(privateBucket(page)).toBeVisible();

    // Already a slug, so the dialog stores the space under exactly this name.
    const name = uniqueSlug('kept');
    await privateBucket(page).getByRole('button', { name: 'New private space' }).click();

    const dialog = page.getByRole('dialog', { name: 'New private space' });
    await dialog.getByLabel('Space name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(`/p/${name}`);
    await expect(row(privateBucket(page), name)).toBeVisible();

    const made = (await api.spaces()).find((space) => space.slug === name);
    expect(made?.owner).toBeTruthy();
    await expect
      .poll(() => content.read('.git/info/exclude'), { message: 'the space never reached the exclude list' })
      .toContain(`/${name}/`);
    expect((await content.trackedFiles()).filter((file) => file.startsWith(`${name}/`))).toEqual([]);
  });

  test('New page follows the reader into the private space', async ({ api, content, page }) => {
    const seeded = await seedPrivate(api, content);

    await page.goto(`/p/${seeded.path}`);
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Salary');
    // A step off the page onto the home route. The action used to fall back to the first space
    // in the tree here, which is a public one, so private work landed where everybody reads it.
    await page.goto('/');

    await newPageFromPalette(page, 'Bonus letter');

    await expect(page).toHaveURL(new RegExp(`/p/${seeded.slug}/`));
    await expect(row(privateBucket(page), 'Bonus letter')).toBeVisible();
    expect((await content.trackedFiles()).filter((file) => file.startsWith(`${seeded.slug}/`))).toEqual([]);
  });

  test('asks before a page leaves the bucket, and git takes it over', async ({
    api,
    content,
    page,
  }) => {
    const seeded = await seedPrivate(api, content);
    const open = await api.createUniqueSpace('open');
    await content.waitForCleanTree();

    // The open page is the one that moves, so the sidebar unfolds its branch on its own.
    await page.goto(`/p/${seeded.path}`);
    const salary = row(privateBucket(page), 'Salary');
    const target = row(pageTree(page), open.name);
    await expect(salary).toBeVisible();
    await expect(target).toBeVisible();

    await salary.dragTo(target);

    const question = page.getByRole('dialog', { name: 'Move out of Private?' });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toHaveCount(0);
    expect((await api.getPage(seeded.path))?.path).toBe(seeded.path);

    await salary.dragTo(target);
    await page.getByRole('dialog', { name: 'Move out of Private?' }).getByRole('button', { name: 'Move it' }).click();

    const moved = `${open.slug}/salary`;
    await expect.poll(async () => (await api.getPage(moved))?.path ?? null).toBe(moved);
    expect(await api.getPage(seeded.path)).toBeNull();

    // Out of the private space means out of the exclude list too, so git takes the file over.
    await content.waitForPageFile(moved);
    await content.waitForCleanTree();
    expect(await content.trackedFiles()).toContain(`${moved}.md`);
  });

  test('hides the space from the operator token, which is nobody', async ({
    api,
    content,
    operatorApi,
  }) => {
    const seeded = await seedPrivate(api, content);

    expect((await operatorApi.spaces()).map((space) => space.slug)).not.toContain(seeded.slug);
    expect((await operatorApi.listPages()).map((item) => item.path)).not.toContain(seeded.path);
    expect(await operatorApi.getPage(seeded.path)).toBeNull();
  });
});
