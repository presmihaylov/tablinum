import { expect, test, uniqueSlug, type ApiClient, type ContentRepo } from './fixtures';
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

/** The space the running test seeded, so the cleanup can take its pages out of the index. */
let seededSlug: string | null = null;

/** A private space with one page written into it, already committed. */
async function seedPrivate(api: ApiClient, content: ContentRepo): Promise<Seeded> {
  const slug = uniqueSlug('vault');
  const space = await api.createSpace({ slug, name: 'Vault', private: true });
  expect(space.owner).toBeTruthy();
  seededSlug = slug;

  const page = await api.createPage({
    path: `${slug}/salary`,
    title: 'Salary',
    markdown: `${SECRET}\n`,
  });
  await content.waitForCleanTree();

  return { slug, path: page.path, file: await content.waitForPageFile(page.path) };
}

test.describe('private spaces', () => {
  test.afterEach(async ({ api }) => {
    const slug = seededSlug;
    seededSlug = null;
    // Through the API rather than by removing the directory: the watcher can miss a file that
    // goes away moments after it arrived, and the page would stay in the index for good.
    if (slug !== null) {
      const home = await api.getPage(slug);
      if (home !== null) await api.deletePage(home.id, { recursive: true });
    }
    await api.reset();
  });

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

  test('shows the space to the person who owns it', async ({ api, content, page }) => {
    const seeded = await seedPrivate(api, content);

    await page.goto(`/p/${seeded.path}`);
    await expect(page.getByLabel('Page title')).toHaveValue('Salary');
    // The Private bucket comes later; for now the space sits in the tree like any other.
    await expect(pageTree(page).getByText('Vault', { exact: true })).toBeVisible();
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
