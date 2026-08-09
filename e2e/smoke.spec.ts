import { expect, test } from './fixtures';
import { ADMIN, DEFAULT_PAGE_PATH } from './env';

test.describe('smoke', () => {
  test('the signed-in admin lands in the shell', async ({ page, api }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('tablinum');
    // The home route forwards to the first page of the first space.
    await expect(page).toHaveURL(new RegExp(`/p/${DEFAULT_PAGE_PATH}$`));

    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'Welcome' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Your account' })).toBeVisible();

    // The same session the browser uses answers as the admin the setup project created.
    const state = await api.authState();
    expect(state.setupRequired).toBe(false);
    expect(state.user?.email).toBe(ADMIN.email);
  });

  test('the starter page is a markdown file in the git repo', async ({ content }) => {
    const file = await content.waitForPageFile(DEFAULT_PAGE_PATH);

    const text = await content.read(file);
    expect(text).toContain('title: Welcome');

    expect(await content.trackedFiles()).toContain(file);
  });

  test('a visitor with no session gets the login screen', async ({ signedOutPage }) => {
    await signedOutPage.goto('/');

    await expect(signedOutPage.getByText('Sign in to edit your docs.')).toBeVisible();
    await expect(signedOutPage.getByLabel('Email')).toBeVisible();
    await expect(signedOutPage.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // The shell must not be behind the login card.
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
  });
});
