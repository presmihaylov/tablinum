import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { ADMIN, BASE_URL, expect, test, uniqueSlug } from './fixtures';
import type { Account } from './helpers/types';

/**
 * A person renames themselves, and every page and comment that named them is rewritten in one
 * commit. The old handle stays reserved, so nobody else can take it.
 */

/** No cookies at all: the browser the invited person opens the link in. */
const EMPTY_STATE = { cookies: [], origins: [] };

const MEMBER_PASSWORD = 'e2e-member-1234';

const people: Account[] = [];
const invites: string[] = [];
const pages: string[] = [];
const contexts: BrowserContext[] = [];

async function createInvite(request: APIRequestContext): Promise<string> {
  const data = { email: `${uniqueSlug('renamer')}@example.com`, role: 'member' };
  const response = await request.post('/api/v1/invites', { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = (await response.json()) as { invite: { id: string }; url: string };
  invites.push(payload.invite.id);
  return payload.url;
}

/** Redeem the invite in a browser that has never seen this server, and keep its session. */
async function joinFromLink(
  browser: Browser,
  url: string,
  name: string,
): Promise<{ page: Page; account: Account }> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: EMPTY_STATE });
  contexts.push(context);

  const token = url.split('/invite/')[1];
  const response = await context.request.post('/api/v1/auth/register', {
    data: { token, name, password: MEMBER_PASSWORD },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const account = ((await response.json()) as { user: Account }).user;
  people.push(account);

  return { page: await context.newPage(), account };
}

async function handleOf(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.get('/api/v1/users');
  expect(response.ok(), await response.text()).toBeTruthy();
  const users = ((await response.json()) as { users: Account[] }).users;
  const found = users.find((user) => user.email === email);
  if (found === undefined) throw new Error(`no account for ${email}`);
  return found.handle;
}

/** Write a comment about the whole page, as the admin. */
async function commentOn(request: APIRequestContext, pageId: string, body: string): Promise<void> {
  const response = await request.post(`/api/v1/pages/${pageId}/comments`, { data: { body } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** The handle field on the account settings page, with the note that says what a change costs. */
async function openHandleField(page: Page) {
  await page.goto('/settings');
  const field = page.getByLabel('Handle', { exact: true });
  await expect(field).toBeVisible();
  return field;
}

test.describe('an editable handle', () => {
  test.afterEach(async ({ api, request }) => {
    for (const id of pages.splice(0)) await api.deletePage(id, { recursive: true });
    for (const context of contexts.splice(0)) await context.close();
    for (const person of people.splice(0)) await request.delete(`/api/v1/users/${person.id}`);
    for (const id of invites.splice(0)) await request.delete(`/api/v1/invites/${id}`);
  });

  test('a rename rewrites the mentions and reserves the old handle', async ({
    api,
    browser,
    request,
  }) => {
    const invited = await createInvite(request);
    const member = await joinFromLink(browser, invited, 'E2E Renamer');
    const before = member.account.handle;
    const after = uniqueSlug('e2e.newname');

    const space = await api.createUniqueSpace('handle');
    const path = `${space.slug}/handover`;
    const seeded = await api.createPage({
      path,
      title: 'Handover',
      markdown: `Ask @${before} about the pipeline.\n`,
    });
    pages.push(seeded.id);
    await commentOn(request, seeded.id, `Over to @${before} from Friday.`);

    const field = await openHandleField(member.page);
    await expect(field).toHaveValue(before);
    await expect(
      member.page.getByText('A change rewrites 1 page and 1 comment in one commit.'),
    ).toBeVisible();

    // A handle somebody else already holds is refused, and the field keeps what was typed.
    await field.fill(await handleOf(request, ADMIN.email));
    await member.page.getByRole('button', { name: 'Change handle' }).click();
    await member.page.getByRole('button', { name: 'Rewrite the mentions' }).click();
    await expect(member.page.locator('.account-form__error')).toContainText('is taken');

    await field.fill(after);
    await member.page.getByRole('button', { name: 'Change handle' }).click();
    await expect(
      member.page.getByText(`@${before} stays reserved for you`, { exact: false }),
    ).toBeVisible();
    await member.page.getByRole('button', { name: 'Rewrite the mentions' }).click();

    await expect(member.page.getByText(`You are now @${after}`)).toBeVisible();
    await expect(field).toHaveValue(after);
    // One change a day, so the button is shut until tomorrow.
    await expect(member.page.getByRole('button', { name: 'Change handle' })).toBeDisabled();

    // The page on disk now names the new handle, and nothing names the old one.
    await expect
      .poll(async () => ((await api.getPage(path))?.markdown ?? '').trim(), {
        message: 'the page still carries the old handle',
      })
      .toBe(`Ask @${after} about the pipeline.`);

    // The editor draws the rewritten mention as a chip, so the rename survived the round trip.
    await member.page.goto(`/p/${path}`);
    await expect(member.page.locator('.gd-editor-mention')).toHaveText(`@${after}`);

    // The comment names the reader, which is what proves the mention still points at them.
    await member.page.getByRole('button', { name: /^Comments, \d+ open$/ }).click();
    const panel = member.page.getByRole('complementary', { name: 'Comments' });
    const chip = panel.locator('.comment__mention');
    await expect(chip).toHaveText(`@${after}`);
    await expect(chip).toHaveClass(/comment__mention--me/);

    // The old handle is reserved, not free: an admin asking for it is refused.
    const taken = await request.post('/api/v1/me/handle', { data: { handle: before } });
    expect(taken.status()).toBe(409);
    expect(await taken.text()).toContain(`@${before} is taken`);
  });
});
