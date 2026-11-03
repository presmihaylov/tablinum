import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { ADMIN, expect, test, uniqueSlug } from './fixtures';

/** One bucket of the sidebar. Each is a <section> with a label of its own. */
function bucket(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** The row of a page inside a bucket. A row carries no role, so the title text is the anchor. */
function row(bucketLocator: Locator, title: string): Locator {
  return bucketLocator.getByText(title, { exact: true });
}

/** The titles in a bucket, top to bottom. */
async function titles(bucketLocator: Locator): Promise<string[]> {
  return bucketLocator.getByRole('listitem').allInnerTexts();
}

const MEMBER_PASSWORD = 'e2e-sidebar-1234';

/**
 * Put another person behind the same browser. The register call runs on the context's own
 * request object, so the session cookie it sets is the one the pages then carry.
 */
async function becomeMember(
  page: Page,
  request: APIRequestContext,
  name: string,
): Promise<{ id: string }> {
  const invited = await request.post('/api/v1/invites', { data: { role: 'member' } });
  expect(invited.ok(), await invited.text()).toBeTruthy();
  const { url } = (await invited.json()) as { url: string };
  const token = url.split('/invite/')[1] ?? '';

  const joined = await page.context().request.post('/api/v1/auth/register', {
    data: { token, name, password: MEMBER_PASSWORD, email: `${uniqueSlug('member')}@example.com` },
  });
  expect(joined.ok(), await joined.text()).toBeTruthy();
  return ((await joined.json()) as { user: { id: string } }).user;
}

/** Hand the browser back to the admin the rest of the suite runs as. */
async function becomeAdmin(page: Page): Promise<void> {
  const back = await page.context().request.post('/api/v1/auth/login', {
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  expect(back.ok(), await back.text()).toBeTruthy();
}

test.describe('sidebar buckets', () => {
  test('shows every space, not only the one that is open', async ({ page, api }) => {
    const first = await api.createUniqueSpace('sidebar-a');
    const second = await api.createUniqueSpace('sidebar-b');

    await page.goto(`/p/${first.slug}`);

    const spaces = bucket(page, 'Spaces');
    await expect(row(spaces, first.name)).toBeVisible();
    await expect(row(spaces, second.name)).toBeVisible();
  });

  test('folds a bucket away and remembers it over a reload', async ({ page, api }) => {
    const space = await api.createUniqueSpace('sidebar-fold');
    await page.goto(`/p/${space.slug}`);

    const spaces = bucket(page, 'Spaces');
    const toggle = spaces.getByRole('button', { name: 'Spaces', exact: true });
    await expect(row(spaces, space.name)).toBeVisible();

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(row(spaces, space.name)).toHaveCount(0);

    await page.reload();

    await expect(bucket(page, 'Spaces').getByRole('button', { name: 'Spaces', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(row(bucket(page, 'Spaces'), space.name)).toHaveCount(0);
  });

  test('lists the pages that were opened, newest first', async ({ page, api }) => {
    const space = await api.createUniqueSpace('sidebar-recent');
    await api.createPage({ path: `${space.slug}/alpha`, title: 'Recent Alpha' });
    await api.createPage({ path: `${space.slug}/bravo`, title: 'Recent Bravo' });

    await page.goto(`/p/${space.slug}/alpha`);
    await expect(page.getByLabel('Page title')).toHaveValue('Recent Alpha');
    await page.goto(`/p/${space.slug}/bravo`);
    await expect(page.getByLabel('Page title')).toHaveValue('Recent Bravo');

    const recents = bucket(page, 'Recents');
    await expect(row(recents, 'Recent Bravo')).toBeVisible();
    await expect(row(recents, 'Recent Alpha')).toBeVisible();

    // The page just opened sits at the top of the bucket.
    expect((await titles(recents)).slice(0, 2)).toEqual(['Recent Bravo', 'Recent Alpha']);

    // A row of the bucket opens its page.
    await row(recents, 'Recent Alpha').click();
    await expect(page).toHaveURL(`/p/${space.slug}/alpha`);
  });

  test('leaves a page where it stands when it is opened again', async ({ page, api }) => {
    const space = await api.createUniqueSpace('sidebar-place');
    await api.createPage({ path: `${space.slug}/alpha`, title: 'Place Alpha' });
    await api.createPage({ path: `${space.slug}/bravo`, title: 'Place Bravo' });
    await api.createPage({ path: `${space.slug}/charlie`, title: 'Place Charlie' });

    // Each visit is a reload, so wait for the page to arrive before leaving it. A visit that is
    // cut short never reaches the bucket.
    for (const [name, title] of [
      ['alpha', 'Place Alpha'],
      ['bravo', 'Place Bravo'],
      ['charlie', 'Place Charlie'],
    ] as const) {
      await page.goto(`/p/${space.slug}/${name}`);
      await expect(page.getByLabel('Page title')).toHaveValue(title);
    }

    const recents = bucket(page, 'Recents');
    await expect(row(recents, 'Place Alpha')).toBeVisible();
    expect((await titles(recents)).slice(0, 3)).toEqual(['Place Charlie', 'Place Bravo', 'Place Alpha']);

    await row(recents, 'Place Alpha').click();
    await expect(page).toHaveURL(`/p/${space.slug}/alpha`);

    // The list does not reshuffle. The row that was clicked is lit where it already stood.
    expect((await titles(recents)).slice(0, 3)).toEqual(['Place Charlie', 'Place Bravo', 'Place Alpha']);
    await expect(recents.getByRole('button', { name: 'Place Alpha' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('gives each person their own list on one browser', async ({ page, api, request }) => {
    const space = await api.createUniqueSpace('sidebar-person');
    await api.createPage({ path: `${space.slug}/alpha`, title: 'Person Alpha' });
    await api.createPage({ path: `${space.slug}/bravo`, title: 'Person Bravo' });

    await page.goto(`/p/${space.slug}/alpha`);
    await expect(row(bucket(page, 'Recents'), 'Person Alpha')).toBeVisible();

    const member = await becomeMember(page, request, 'Sidebar Member');
    try {
      await page.goto(`/p/${space.slug}/bravo`);

      // The same browser, another person: nothing of the admin's reading is on show.
      await expect(row(bucket(page, 'Recents'), 'Person Bravo')).toBeVisible();
      await expect(row(bucket(page, 'Recents'), 'Person Alpha')).toHaveCount(0);
    } finally {
      await becomeAdmin(page);
      await request.delete(`/api/v1/users/${member.id}`);
    }

    await page.goto(`/p/${space.slug}/alpha`);

    await expect(row(bucket(page, 'Recents'), 'Person Alpha')).toBeVisible();
    await expect(row(bucket(page, 'Recents'), 'Person Bravo')).toHaveCount(0);
  });

  test('never offers a shared space to a member, who may still make a private one', async ({
    page,
    api,
    request,
  }) => {
    const space = await api.createUniqueSpace('sidebar-role');
    await page.goto(`/p/${space.slug}`);
    await expect(bucket(page, 'Spaces').getByRole('button', { name: 'New space' })).toBeVisible();

    const member = await becomeMember(page, request, 'Sidebar Gated');
    try {
      await page.goto(`/p/${space.slug}`);

      // The server refuses POST /spaces to a member, so the action must not be on offer at all.
      await expect(bucket(page, 'Private').getByRole('button', { name: 'New private space' })).toBeVisible();
      await expect(bucket(page, 'Spaces').getByRole('button', { name: 'New space' })).toHaveCount(0);
    } finally {
      await becomeAdmin(page);
      await request.delete(`/api/v1/users/${member.id}`);
    }
  });

  test('creates a space from the header of the Spaces bucket', async ({ page, api }) => {
    const home = await api.createUniqueSpace('sidebar-new');
    await page.goto(`/p/${home.slug}`);

    // Already a slug, so the dialog stores it under exactly this name.
    const name = uniqueSlug('made');
    await bucket(page, 'Spaces').getByRole('button', { name: 'New space' }).click();

    const dialog = page.getByRole('dialog', { name: 'New space' });
    await dialog.getByLabel('Space name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(`/p/${name}`);
    await expect(row(bucket(page, 'Spaces'), name)).toBeVisible();
    expect((await api.spaces()).map((one) => one.slug)).toContain(name);
  });
});
