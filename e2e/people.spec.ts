import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { ADMIN, BASE_URL, expect, test, uniqueSlug } from './fixtures';
import type { Account } from './helpers/types';

/** No cookies at all: the browser the invited person opens the link in. */
const EMPTY_STATE = { cookies: [], origins: [] };

const MEMBER_PASSWORD = 'e2e-member-1234';

interface Invited {
  id: string;
  url: string;
}

interface Joined {
  context: BrowserContext;
  page: Page;
  account: Account;
}

async function createInvite(
  request: APIRequestContext,
  body: { email?: string; role?: 'admin' | 'member' },
): Promise<Invited> {
  const response = await request.post('/api/v1/invites', { data: body });
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = (await response.json()) as { invite: { id: string }; url: string };
  return { id: payload.invite.id, url: payload.url };
}

function tokenOf(url: string): string {
  const token = url.split('/invite/')[1];
  if (token === undefined || token.length === 0) throw new Error(`no invite token in ${url}`);
  return token;
}

async function listUsers(request: APIRequestContext): Promise<Account[]> {
  const response = await request.get('/api/v1/users');
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { users: Account[] }).users;
}

async function setRole(request: APIRequestContext, id: string, role: 'admin' | 'member'): Promise<void> {
  const response = await request.patch(`/api/v1/users/${id}`, { data: { role } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

function uniqueEmail(prefix: string): string {
  return `${uniqueSlug(prefix)}@example.com`;
}

const people: Account[] = [];
const invites: string[] = [];
const pages: string[] = [];
const contexts: BrowserContext[] = [];

/**
 * Redeem an invite in a browser that has never seen this server. The register call runs on the
 * context's own request object, so the session cookie it sets is the one the pages then carry.
 */
async function joinFromLink(
  browser: Browser,
  invited: Invited,
  person: { email?: string; name: string },
): Promise<Joined> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: EMPTY_STATE });
  contexts.push(context);

  const response = await context.request.post('/api/v1/auth/register', {
    data: {
      token: tokenOf(invited.url),
      name: person.name,
      password: MEMBER_PASSWORD,
      ...(person.email === undefined ? {} : { email: person.email }),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const account = ((await response.json()) as { user: Account }).user;
  people.push(account);

  return { context, page: await context.newPage(), account };
}

/** The roster lives on the settings page now, reached from the avatar in the sidebar. */
async function openPeopleDialog(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'People and invites' }).click();
  const panel = page.getByRole('region', { name: 'People and invites' });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Run something while the given account is the only admin on the install. Another spec may have
 * left a second admin behind, and the last-admin rule only bites when exactly one is left.
 */
async function withSoleAdmin(
  request: APIRequestContext,
  keepId: string,
  run: () => Promise<void>,
): Promise<void> {
  const others = (await listUsers(request)).filter((user) => user.role === 'admin' && user.id !== keepId);
  for (const other of others) await setRole(request, other.id, 'member');
  try {
    await run();
  } finally {
    // A best effort: the account may have been removed by whatever created it.
    for (const other of others) await request.patch(`/api/v1/users/${other.id}`, { data: { role: 'admin' } });
  }
}

test.describe('people, invites and roles', () => {
  test.afterEach(async ({ api, request }) => {
    for (const id of pages.splice(0)) await api.deletePage(id, { recursive: true });
    for (const context of contexts.splice(0)) await context.close();
    // A promoted account is demoted first, or the delete would refuse to drop the last admin.
    for (const person of people.splice(0)) {
      await request.patch(`/api/v1/users/${person.id}`, { data: { role: 'member' } });
      await request.delete(`/api/v1/users/${person.id}`);
    }
    for (const id of invites.splice(0)) await request.delete(`/api/v1/invites/${id}`);
  });

  test('an admin sees the people screen', async ({ page }) => {
    const dialog = await openPeopleDialog(page);

    await expect(dialog.getByText('Invite somebody')).toBeVisible();
    await expect(dialog.getByText('The link lasts 14 days.')).toBeVisible();
    await expect(dialog.getByText('Accounts')).toBeVisible();

    // The role select fills the row, so the name and the address are squeezed to no width at
    // all: they are in the row, but only the controls named after them can be seen.
    await expect(dialog.getByText(`${ADMIN.name} (you)`)).toHaveCount(1);
    await expect(dialog.getByText(ADMIN.email)).toHaveCount(1);
    await expect(dialog.getByLabel(`Role of ${ADMIN.name}`)).toHaveValue('admin');

    // Nobody may remove the account they are signed in as.
    await expect(dialog.getByRole('button', { name: `Remove ${ADMIN.name}` })).toBeDisabled();
  });

  test('creating an invite produces a link and lists it as waiting', async ({ page, request }) => {
    const email = uniqueEmail('invitee');
    const dialog = await openPeopleDialog(page);

    await dialog.getByPlaceholder('name@example.com (optional)').fill(email);
    await dialog.getByLabel('Role', { exact: true }).selectOption('member');
    await dialog.getByRole('button', { name: 'Create link' }).click();

    const link = dialog.getByText(new RegExp(`^${BASE_URL}/invite/`));
    await expect(link).toBeVisible();
    const url = (await link.textContent()) ?? '';
    expect(tokenOf(url).length).toBeGreaterThan(8);

    await expect(dialog.getByText('Invites waiting')).toBeVisible();
    await expect(dialog.getByText(email)).toBeVisible();
    await expect(dialog.getByText(/^member · expires /)).toBeVisible();

    // The link the screen showed is the one the server will honour.
    const preview = await request.get(`/api/v1/auth/invite/${tokenOf(url)}`);
    expect(preview.ok(), await preview.text()).toBeTruthy();
    expect(await preview.json()).toMatchObject({ email, role: 'member', invitedBy: ADMIN.name });

    const pending = (await request.get('/api/v1/invites')).json() as Promise<{
      invites: { id: string; email: string | null }[];
    }>;
    const mine = (await pending).invites.find((invite) => invite.email === email);
    expect(mine).toBeDefined();
    if (mine) invites.push(mine.id);
  });

  test('redeeming an invite link creates a second account and signs it in', async ({
    request,
    signedOutPage,
  }) => {
    const email = uniqueEmail('joiner');
    const invited = await createInvite(request, { email, role: 'member' });
    invites.push(invited.id);

    await signedOutPage.goto(invited.url);

    await expect(signedOutPage.getByText(`${ADMIN.name} invited you to these docs.`)).toBeVisible();
    // The address is pinned by the link, so the form cannot be pointed somewhere else.
    await expect(signedOutPage.getByLabel('Email')).toHaveValue(email);
    await expect(signedOutPage.getByLabel('Email')).toBeDisabled();

    await signedOutPage.getByLabel('Your name').fill('E2E Joiner');
    await signedOutPage.getByLabel('Password').fill(MEMBER_PASSWORD);
    await signedOutPage.getByRole('button', { name: 'Join' }).click();

    // Joining lands straight in the shell: no second sign in.
    await expect(signedOutPage).toHaveURL(/\/p\//);
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toBeVisible();

    await signedOutPage.getByRole('button', { name: 'Your account' }).click();
    await expect(signedOutPage.getByText('E2E Joiner')).toBeVisible();
    await expect(signedOutPage.getByText(email)).toBeVisible();

    const joined = (await listUsers(request)).find((user) => user.email === email);
    expect(joined).toBeDefined();
    expect(joined?.role).toBe('member');
    if (joined) people.push(joined);
  });

  test('a new member can read and edit a page', async ({ api, browser, request }) => {
    const seeded = await api.createPage({
      path: `docs/${uniqueSlug('notes')}`,
      title: 'Team notes',
      markdown: 'The team notes live here.\n',
    });
    pages.push(seeded.id);

    const invited = await createInvite(request, { email: uniqueEmail('reader'), role: 'member' });
    invites.push(invited.id);
    const member = await joinFromLink(browser, invited, { name: 'E2E Reader' });

    await member.page.goto(`/p/${seeded.path}`);

    await expect(member.page.getByLabel('Page title')).toHaveValue('Team notes');
    await expect(member.page.getByText('The team notes live here.')).toBeVisible();

    await member.page.getByLabel('Page title').fill('Team notes, edited by a member');

    await expect
      .poll(async () => (await api.getPage(seeded.path))?.title, {
        message: 'the edit a member made never reached the store',
      })
      .toBe('Team notes, edited by a member');
    await expect(member.page.getByRole('treeitem', { name: 'Team notes, edited by a member' })).toBeVisible();
  });

  test('a member does not see or reach the admin-only screens', async ({ browser, request }) => {
    const invited = await createInvite(request, { email: uniqueEmail('plain'), role: 'member' });
    invites.push(invited.id);
    const member = await joinFromLink(browser, invited, { name: 'E2E Plain' });

    await member.page.goto('/');
    await member.page.getByRole('button', { name: 'Your account' }).click();
    await expect(member.page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    await expect(member.page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();

    // The settings page offers a member no admin section, whatever the path asks for.
    await member.page.goto('/settings/people');
    await expect(member.page.getByRole('heading', { name: 'My account' })).toBeVisible();
    await expect(member.page.getByRole('button', { name: 'People and invites' })).toHaveCount(0);
    await expect(member.page.getByRole('button', { name: 'Agents' })).toHaveCount(0);

    const admin = (await listUsers(request)).find((user) => user.email === ADMIN.email);
    expect(admin).toBeDefined();

    // The screens are hidden, and the endpoints behind them refuse the member outright.
    const api = member.context.request;
    expect((await api.get('/api/v1/invites')).status()).toBe(401);
    expect((await api.post('/api/v1/invites', { data: { role: 'admin' } })).status()).toBe(401);
    expect((await api.get('/api/v1/agents')).status()).toBe(401);
    expect((await api.patch(`/api/v1/users/${admin?.id ?? ''}`, { data: { role: 'member' } })).status()).toBe(401);
    expect((await api.delete(`/api/v1/users/${admin?.id ?? ''}`)).status()).toBe(401);

    // Reading and writing pages is still allowed: a member is not a guest.
    expect((await api.get('/api/v1/tree')).ok()).toBeTruthy();
  });

  test('an admin can change a role', async ({ browser, page, request }) => {
    const invited = await createInvite(request, { email: uniqueEmail('promoted'), role: 'member' });
    invites.push(invited.id);
    const member = await joinFromLink(browser, invited, { name: 'E2E Promoted' });

    const dialog = await openPeopleDialog(page);
    const select = dialog.getByLabel('Role of E2E Promoted');
    await expect(select).toHaveValue('member');

    await select.selectOption('admin');
    await expect(select).toHaveValue('admin');
    await expect
      .poll(async () => (await listUsers(request)).find((user) => user.id === member.account.id)?.role)
      .toBe('admin');

    // The new admin sees the admin screens as soon as the browser asks again.
    await member.page.goto('/settings');
    await expect(member.page.getByRole('button', { name: 'People and invites' })).toBeVisible();

    await select.selectOption('member');
    await expect(select).toHaveValue('member');
    await expect
      .poll(async () => (await listUsers(request)).find((user) => user.id === member.account.id)?.role)
      .toBe('member');
  });

  test('the only admin can be neither demoted nor removed', async ({ page, request }) => {
    const admin = (await listUsers(request)).find((user) => user.email === ADMIN.email);
    expect(admin).toBeDefined();
    const adminId = admin?.id ?? '';

    await withSoleAdmin(request, adminId, async () => {
      const dialog = await openPeopleDialog(page);
      const select = dialog.getByLabel(`Role of ${ADMIN.name}`);

      await select.selectOption('member');

      await expect(dialog.getByText('This is the only admin. Promote somebody else first.')).toBeVisible();
      // The screen falls back to what the server still holds.
      await expect(select).toHaveValue('admin');

      const demote = await request.patch(`/api/v1/users/${adminId}`, { data: { role: 'member' } });
      expect(demote.status()).toBe(409);
      expect(await demote.text()).toContain('This is the only admin. Promote somebody else first.');

      // Your own account is refused before the admin count is even looked at.
      const remove = await request.delete(`/api/v1/users/${adminId}`);
      expect(remove.status()).toBe(409);
      expect(await remove.text()).toContain('Removing your own account would sign you out.');

      expect((await listUsers(request)).find((user) => user.id === adminId)?.role).toBe('admin');
    });
  });
});
