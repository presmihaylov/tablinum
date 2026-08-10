import type { Locator, Page } from '@playwright/test';
import { expect, test, type ApiClient, type ContentRepo } from './fixtures';
import { pageMenu } from './menus';

/** The three states the seeded page walks through, one commit each. */
const FIRST = 'Version one.';
const SECOND = 'Version two.';
const THIRD = 'Version three.';

const PAGE_TITLE = 'Release notes';
/** The author the server commits as. See TABLINUM_GIT_AUTHOR_NAME in the config. */
const AUTHOR = 'tablinum e2e';

/** Named here rather than imported: the spec must see what the server really writes. */
const TEMP_FILE_PREFIX = '.tablinum-tmp-';
const TEMP_FILE_PATTERN = `${TEMP_FILE_PREFIX}*`;

interface Seeded {
  path: string;
  /** Repo-relative markdown file behind the page. */
  file: string;
}

/**
 * A space and a page nothing else touches, each already committed. The wait between the two
 * writes matters: inside the autocommit window both would land in one commit, and the page
 * would have no "Create" revision of its own.
 */
async function seedPage(api: ApiClient, content: ContentRepo): Promise<Seeded> {
  const space = await api.createUniqueSpace('history');
  await content.waitForCleanTree();

  const page = await api.createPage({
    path: `${space.slug}/notes`,
    title: PAGE_TITLE,
    markdown: `${FIRST}\n`,
  });
  await content.waitForCleanTree();

  return { path: page.path, file: await content.waitForPageFile(page.path) };
}

async function openPage(page: Page, path: string): Promise<void> {
  await page.goto(`/p/${path}`);
  await expect(page.getByLabel('Page title')).toHaveValue(PAGE_TITLE);
}

/** Rewrite the body the way a person does: select the paragraph, type over it. */
async function rewriteBody(page: Page, current: string, next: string): Promise<void> {
  await page.getByText(current, { exact: true }).click({ clickCount: 3 });
  await page.keyboard.insertText(next);
}

/** Type over the body, then wait for the save and the debounced commit to land. */
async function commitEdit(
  page: Page,
  content: ContentRepo,
  seeded: Seeded,
  current: string,
  next: string,
): Promise<void> {
  await rewriteBody(page, current, next);
  await expect.poll(() => content.read(seeded.file), { message: 'the edit never reached disk' }).toContain(next);
  await content.waitForCleanTree();
}

/**
 * The history list of the details rail. The page menu is what brings the rail out, and only
 * the history is asked for, so its entries are the only list items in the rail.
 */
async function openHistory(page: Page): Promise<Locator> {
  await pageMenu(page, 'History');
  const details = page.getByRole('complementary', { name: 'Page details' });
  await expect(details).toBeVisible();
  return details.getByRole('listitem');
}

test.describe('git history and revisions', () => {
  test('two edits add two entries to the history of a page', async ({ page, api, content }) => {
    const seeded = await seedPage(api, content);
    await openPage(page, seeded.path);

    await commitEdit(page, content, seeded, FIRST, SECOND);
    await commitEdit(page, content, seeded, SECOND, THIRD);

    const entries = await openHistory(page);
    await expect(entries).toHaveCount(3);
    // Newest first, and each message is the one the route recorded for that write.
    await expect(entries.nth(0)).toContainText(`Update ${seeded.path}`);
    await expect(entries.nth(1)).toContainText(`Update ${seeded.path}`);
    await expect(entries.nth(2)).toContainText(`Create ${seeded.path}`);
    await expect(entries.nth(0)).toContainText(AUTHOR);

    // git tells the same story about the same file.
    const subjects = await content.git('log', '--format=%s', '--', seeded.file);
    expect(subjects.split('\n')).toEqual([
      `Update ${seeded.path}`,
      `Update ${seeded.path}`,
      `Create ${seeded.path}`,
    ]);
  });

  test('an older revision opens and shows the older text', async ({ page, api, content }) => {
    const seeded = await seedPage(api, content);
    await openPage(page, seeded.path);

    await commitEdit(page, content, seeded, FIRST, SECOND);

    const entries = await openHistory(page);
    await expect(entries).toHaveCount(2);
    // The oldest entry is the page as it was created.
    await entries.last().getByRole('button').click();

    const dialog = page.getByRole('dialog', { name: /^Revision [0-9a-f]{7}$/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(PAGE_TITLE);
    await expect(dialog).toContainText(FIRST);
    await expect(dialog).not.toContainText(SECOND);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    // The revision is read only: the editor still holds the current text.
    await expect(page.getByText(SECOND, { exact: true })).toBeVisible();
  });

  test('the git pill shows a pending change and then a clean tree', async ({ page, api, content }) => {
    const seeded = await seedPage(api, content);
    await openPage(page, seeded.path);

    const branch = await content.git('rev-parse', '--abbrev-ref', 'HEAD');
    // The dirty badge is a bare number, so the pill is located by the tooltip of its info box:
    // a test run configures no remote. Its text is the branch plus one badge per state, so a
    // pending change reads as the branch with a count stuck to it.
    const pill = page.getByTitle('No remote configured');
    await expect(pill).toHaveText(branch);

    // Autocommit is 200 ms, so a pending change only lasts while the commit cannot run. git
    // refuses to touch the index while this lock exists, and the watcher ignores all of .git.
    await content.write('.git/index.lock', '');
    try {
      await rewriteBody(page, FIRST, SECOND);
      await expect
        .poll(() => content.git('diff', '--name-only'), { message: 'the edit never made the tree dirty' })
        .toBe(seeded.file);

      // The pill refetches on load, so a reload is the shortest way to the fresh status.
      await page.reload();
      await expect(pill).toHaveText(`${branch}1`);
    } finally {
      await content.remove('.git/index.lock');
    }

    const message = `e2e: commit ${seeded.path}`;
    expect(await api.commit(message)).not.toBeNull();
    await content.waitForCleanTree();

    await page.reload();
    await expect(pill).toHaveText(branch);

    // The commit is a real commit over the real file, not just a cleared badge.
    expect(await content.git('log', '-1', '--format=%s', '--', seeded.file)).toBe(message);
    expect(await content.git('show', '--format=', '--name-only', 'HEAD')).toContain(seeded.file);
  });

  test('a history entry names a commit that exists in the content repository', async ({
    page,
    api,
    content,
  }) => {
    const seeded = await seedPage(api, content);
    await openPage(page, seeded.path);
    await commitEdit(page, content, seeded, FIRST, SECOND);

    const entries = await openHistory(page);
    const newest = entries.first().getByRole('button');
    await expect(newest).toContainText(`Update ${seeded.path}`);

    // The entry prints its abbreviated sha in the only <code> it holds.
    const short = ((await newest.locator('code').textContent()) ?? '').trim();
    expect(short).toMatch(/^[0-9a-f]{7}$/);

    const full = await content.git('rev-parse', short);
    expect(full).toMatch(/^[0-9a-f]{40}$/);
    expect(full.startsWith(short)).toBe(true);

    // That commit is the newest one over this page file, and it carries the file.
    expect(await content.git('log', '-1', '--format=%H', '--', seeded.file)).toBe(full);
    expect(await content.git('show', '--format=', '--name-only', full)).toContain(seeded.file);
  });

  test('a save never commits the file it writes before the rename', async ({ api, content }) => {
    const seeded = await seedPage(api, content);

    // A save writes its bytes beside the page, then moves them over it. The autocommit runs on a
    // timer of its own, so git must be told to skip whatever it finds mid-save.
    expect(await content.read('.git/info/exclude')).toContain(TEMP_FILE_PATTERN);
    const tracked = await content.trackedFiles();
    expect(tracked).toContain(seeded.file);
    expect(tracked.filter((file) => file.includes(TEMP_FILE_PREFIX))).toEqual([]);
  });
});
