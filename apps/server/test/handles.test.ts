import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentTokenResponseSchema,
  AuthResponseSchema,
  CommentThreadResponseSchema,
  HandleChangeResponseSchema,
  HandlePreviewResponseSchema,
  HistoryResponseSchema,
  InviteResponseSchema,
  PageResponseSchema,
} from '@tablinum/shared';
import { contextOf } from '../src/context.js';
import type { SlackApi } from '../src/slack.js';
import { bodyOf, makeHarness, TEST_TOKEN, type Harness } from './support/harness.js';

/**
 * Changing a handle.
 *
 * A mention is plain text, so the interesting part is not the account row: it is that every page
 * and every comment naming the old handle comes out naming the new one, in one commit.
 */

const ADMIN = { email: 'ada@example.com', name: 'Ada Lovelace', password: 'stack-of-pancakes' };

const open: Harness[] = [];

afterEach(async () => {
  while (open.length > 0) {
    const harness = open.pop();
    if (harness !== undefined) await harness.close();
  }
});

async function harnessFor(options: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const harness = await makeHarness(options);
  open.push(harness);
  return harness;
}

function cookiePair(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

/** The first account, and the cookie it writes with. An operator token names nobody. */
async function claim(harness: Harness): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    payload: ADMIN,
  });
  expect(response.statusCode).toBe(200);
  return cookiePair(response);
}

/** A second person in the same workspace, and the cookie they write with. */
async function invite(
  harness: Harness,
  adminCookie: string,
  person: { email: string; name: string },
): Promise<{ cookie: string; id: string; handle: string }> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/invites',
    headers: { cookie: adminCookie },
    payload: { email: person.email },
  });
  const issued = bodyOf(created, InviteResponseSchema);
  const token = issued.url.slice(issued.url.lastIndexOf('/') + 1);

  const registered = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { token, name: person.name, password: 'nanoseconds-please' },
  });
  expect(registered.statusCode).toBe(200);
  const account = bodyOf(registered, AuthResponseSchema).user;
  return { cookie: cookiePair(registered), id: account.id, handle: account.handle };
}

async function makeSpace(harness: Harness): Promise<void> {
  await harness.app.inject({
    method: 'POST',
    url: '/api/v1/spaces',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    payload: { slug: 'eng', name: 'Engineering' },
  });
}

async function makePage(harness: Harness, markdown: string, path = 'eng/notes') {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    payload: { path, title: 'Notes', markdown },
  });
  expect(response.statusCode).toBe(201);
  return bodyOf(response, PageResponseSchema).page;
}

async function readPage(harness: Harness, id: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/pages/${id}`,
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
  });
  return bodyOf(response, PageResponseSchema).page.markdown;
}

async function revisions(harness: Harness, id: string) {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/pages/${id}/history`,
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
  });
  return bodyOf(response, HistoryResponseSchema).revisions;
}

async function changeHandle(harness: Harness, cookie: string, handle: string) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/me/handle',
    headers: { cookie },
    payload: { handle },
  });
}

async function previewHandle(harness: Harness, cookie: string) {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/me/handle',
    headers: { cookie },
  });
  return bodyOf(response, HandlePreviewResponseSchema);
}

/** A page in a private space belonging to `cookie`. Nobody else may read it, not even an admin. */
async function makePrivatePage(harness: Harness, cookie: string, markdown: string): Promise<string> {
  const space = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/spaces',
    headers: { cookie },
    payload: { slug: 'ledger', name: 'Ledger', private: true },
  });
  expect(space.statusCode).toBe(200);

  const page = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: { cookie },
    payload: { path: 'ledger/pay', title: 'Pay', markdown },
  });
  expect(page.statusCode).toBe(201);
  return bodyOf(page, PageResponseSchema).page.id;
}

/**
 * Save into the gap between the sweep reading a page and writing it back.
 *
 * The sweep reads every page in the workspace before it writes any of them, so on a real
 * workspace that gap is seconds long. The patch fires once, the first time `id` is read.
 */
function saveDuringSweep(harness: Harness, id: string, markdown: string): void {
  const store = harness.store;
  const read = store.getPageById.bind(store);
  let raced = false;
  store.getPageById = async (wanted) => {
    const found = await read(wanted);
    if (raced || wanted !== id || found === null) return found;
    raced = true;
    await store.updatePage(id, { markdown, baseRev: found.rev });
    return found;
  };
}

describe('GET /me/handle', () => {
  it('counts nothing when nobody has been mentioned', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me/handle',
      headers: { cookie },
    });
    expect(bodyOf(response, HandlePreviewResponseSchema)).toEqual({
      handle: 'ada.lovelace',
      pages: 0,
      comments: 0,
      changeableAt: null,
    });
  });

  it('counts the pages and comments that carry the handle', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    await makeSpace(harness);
    const page = await makePage(harness, 'Ask @ada.lovelace about the build.');
    await makePage(harness, 'Nobody is named here.', 'eng/other');

    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/pages/${page.id}/comments`,
      headers: { cookie },
      payload: { body: 'and @ada.lovelace again' },
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me/handle',
      headers: { cookie },
    });
    const preview = bodyOf(response, HandlePreviewResponseSchema);
    expect(preview.pages).toBe(1);
    expect(preview.comments).toBe(1);
  });

  it('never counts a page in a private space belonging to somebody else', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const grace = await invite(harness, cookie, { email: 'g@example.com', name: 'Grace Hopper' });
    const pageId = await makePrivatePage(harness, cookie, `Pay @${grace.handle} more.`);

    const denied = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${pageId}`,
      headers: { cookie: grace.cookie },
    });
    expect(denied.statusCode).toBe(404);

    // Grace cannot open the page. A count that included it would say the page exists and say
    // how much of it names her, which is the whole of what the space is keeping back.
    expect((await previewHandle(harness, grace.cookie)).pages).toBe(0);
  });

  it('counts a page in the private space the reader owns', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    await makePrivatePage(harness, cookie, 'Pay @ada.lovelace more.');

    expect((await previewHandle(harness, cookie)).pages).toBe(1);
  });

  it('refuses an operator token, which names nobody', async () => {
    const harness = await harnessFor();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me/handle',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /me/handle', () => {
  it('rewrites every page and comment that names the old handle', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    await makeSpace(harness);
    const page = await makePage(harness, 'Ask @ada.lovelace, not `@ada.lovelace`.');
    const untouched = await makePage(harness, 'Ask @ada.lovelace.2 instead.', 'eng/other');

    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/pages/${page.id}/comments`,
      headers: { cookie },
      payload: { body: 'yes, @ada.lovelace knows' },
    });
    const thread = bodyOf(created, CommentThreadResponseSchema).thread;

    const response = await changeHandle(harness, cookie, 'ada.king');
    const result = bodyOf(response, HandleChangeResponseSchema);
    expect(result.user.handle).toBe('ada.king');
    expect(result.previous).toBe('ada.lovelace');
    expect(result.rewritten).toEqual({ pages: 1, comments: 1, skipped: 0 });

    expect(await readPage(harness, page.id)).toBe('Ask @ada.king, not `@ada.lovelace`.');
    expect(await readPage(harness, untouched.id)).toBe('Ask @ada.lovelace.2 instead.');

    const listed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${page.id}/comments`,
      headers: { cookie },
    });
    const body: unknown = JSON.parse(listed.body);
    expect(JSON.stringify(body)).toContain('@ada.king');
    expect(thread.comments[0]?.body).toContain('@ada.lovelace');
  });

  it('makes one commit for the whole rewrite', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    await makeSpace(harness);
    const first = await makePage(harness, 'One @ada.lovelace here.');
    await makePage(harness, 'Two @ada.lovelace there.', 'eng/other');
    await harness.git.flush();

    const before = await revisions(harness, first.id);
    await changeHandle(harness, cookie, 'ada.king');
    const after = await revisions(harness, first.id);

    expect(after.length).toBe(before.length + 1);
    expect(after[0]?.message).toBe('Rename @ada.lovelace to @ada.king in 2 pages');
  });

  it('keeps an edit made while the sweep was running', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    await makeSpace(harness);
    const page = await makePage(harness, 'Ask @ada.lovelace about the build.\n\nNothing else yet.');

    // Somebody saves between the read and the write. Without a base rev the sweep would write
    // the text it read back over the top, and that person's line would never have existed.
    saveDuringSweep(harness, page.id, 'Ask @ada.lovelace about the build.\n\nGrace was here.');

    const response = await changeHandle(harness, cookie, 'ada.king');
    expect(bodyOf(response, HandleChangeResponseSchema).rewritten).toEqual({
      pages: 1,
      comments: 0,
      skipped: 0,
    });

    const markdown = await readPage(harness, page.id);
    expect(markdown).toContain('@ada.king');
    expect(markdown).toContain('Grace was here.');
  });

  it('reports a page it could not rewrite and renames the rest anyway', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    await makeSpace(harness);
    const contested = await makePage(harness, 'Ask @ada.lovelace about the build.');
    const other = await makePage(harness, 'Two @ada.lovelace there.', 'eng/other');

    // Somebody hands the note to another person while the sweep runs, so both sides rewrite the
    // same word and no merge is possible. One page that will not take the rename must not abort
    // it: the other page still changes and the caller is told the count.
    saveDuringSweep(harness, contested.id, 'Ask @grace.hopper about the build.');

    const response = await changeHandle(harness, cookie, 'ada.king');
    expect(bodyOf(response, HandleChangeResponseSchema).rewritten).toEqual({
      pages: 1,
      comments: 0,
      skipped: 1,
    });

    expect(await readPage(harness, contested.id)).toBe('Ask @grace.hopper about the build.');
    expect(await readPage(harness, other.id)).toBe('Two @ada.king there.');
  });

  it('rewrites a private space it is not allowed to read from', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const grace = await invite(harness, cookie, { email: 'g@example.com', name: 'Grace Hopper' });
    const pageId = await makePrivatePage(harness, cookie, `Pay @${grace.handle} more.`);

    // The preview hides this page from Grace, and the sweep still has to change it. A handle
    // names one person everywhere, so a file left behind would keep naming her after somebody
    // else took the old handle.
    const response = await changeHandle(harness, grace.cookie, 'grace.murray');
    expect(bodyOf(response, HandleChangeResponseSchema).rewritten.pages).toBe(1);

    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${pageId}`,
      headers: { cookie },
    });
    expect(bodyOf(read, PageResponseSchema).page.markdown).toBe('Pay @grace.murray more.');
  });

  it('leaves a save that was still pending out of the rename commit', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    await makeSpace(harness);
    await makePage(harness, 'One @ada.lovelace here.');
    const other = await makePage(harness, 'Nobody is named here.', 'eng/other');
    await harness.git.flush();

    // An ordinary save is debounced, so this one is still uncommitted when the rename starts.
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${other.id}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { markdown: 'Still nobody is named here.' },
    });

    await changeHandle(harness, cookie, 'ada.king');

    // `git add -A` would otherwise carry this page into the rename commit, and the message
    // would then say a rename touched a page that never held the handle.
    expect((await revisions(harness, other.id))[0]?.message).toBe('Update eng/other');
  });

  it('keeps the old handle pointing at the same person', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const me = harness.accounts.getUserByHandle('ada.lovelace');

    await changeHandle(harness, cookie, 'ada.king');

    expect(harness.accounts.getUserByHandle('ada.lovelace')?.id).toBe(me?.id);
  });

  it('still tells the person when a stale page mentions the old handle', async () => {
    const sent: string[] = [];
    const slack: SlackApi = {
      lookupByEmail: () => Promise.resolve('U01ABCDEF'),
      postMessage: (userId: string) => {
        sent.push(userId);
        return Promise.resolve(true);
      },
    };
    const harness = await harnessFor({ slack });
    const cookie = await claim(harness);
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/slack',
      headers: { cookie },
      payload: {},
    });
    await makeSpace(harness);
    await changeHandle(harness, cookie, 'ada.king');

    await makePage(harness, 'A copy that nobody rewrote still says @ada.lovelace.');
    await contextOf(harness.app)?.mentions.idle();

    expect(sent).toEqual(['U01ABCDEF']);
  });

  it('refuses a handle another person already holds', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const grace = await invite(harness, cookie, { email: 'g@example.com', name: 'Grace Hopper' });

    const response = await changeHandle(harness, grace.cookie, 'ada.lovelace');
    expect(response.statusCode).toBe(409);
  });

  it('refuses a handle an agent holds', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { name: 'Doc Bot' },
    });
    const agent = bodyOf(created, AgentTokenResponseSchema).agent;

    const response = await changeHandle(harness, cookie, agent.handle);
    expect(response.statusCode).toBe(409);
  });

  it('refuses a second change on the same day', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    expect((await changeHandle(harness, cookie, 'ada.king')).statusCode).toBe(200);
    const again = await changeHandle(harness, cookie, 'ada.byron');
    expect(again.statusCode).toBe(409);
    expect(harness.accounts.getUserByHandle('ada.king')).not.toBeNull();
  });

  it('reports the cooldown in the preview', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    await changeHandle(harness, cookie, 'ada.king');

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me/handle',
      headers: { cookie },
    });
    const preview = bodyOf(response, HandlePreviewResponseSchema);
    expect(preview.handle).toBe('ada.king');
    expect(preview.changeableAt).not.toBeNull();
  });

  it('refuses a handle that breaks the rules', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    expect((await changeHandle(harness, cookie, 'ada lovelace')).statusCode).toBe(400);
  });

  it('does nothing when the wanted handle is already theirs', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const response = await changeHandle(harness, cookie, 'ada.lovelace');
    const result = bodyOf(response, HandleChangeResponseSchema);
    expect(result.previous).toBeNull();
    expect(result.rewritten).toEqual({ pages: 0, comments: 0, skipped: 0 });
  });
});

describe('POST /users/:id/handle', () => {
  it('lets an admin change somebody else', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const grace = await invite(harness, cookie, { email: 'g@example.com', name: 'Grace Hopper' });
    await makeSpace(harness);
    const page = await makePage(harness, `Ask @${grace.handle} about it.`);

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/users/${grace.id}/handle`,
      headers: { cookie },
      payload: { handle: 'amazing.grace' },
    });
    expect(bodyOf(response, HandleChangeResponseSchema).user.handle).toBe('amazing.grace');
    expect(await readPage(harness, page.id)).toBe('Ask @amazing.grace about it.');
  });

  it('refuses a member changing somebody else', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const grace = await invite(harness, cookie, { email: 'g@example.com', name: 'Grace Hopper' });
    const sam = await invite(harness, cookie, { email: 's@example.com', name: 'Sam Rivers' });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/users/${grace.id}/handle`,
      headers: { cookie: sam.cookie },
      payload: { handle: 'amazing.grace' },
    });
    expect(response.statusCode).toBe(401);
    expect(harness.accounts.getUser(grace.id)?.handle).toBe(grace.handle);
  });

  it('reports an unknown account', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/users/us_01J8XYZABCDEFGHJKMNPQRSTVW/handle',
      headers: { cookie },
      payload: { handle: 'nobody.here' },
    });
    expect(response.statusCode).toBe(404);
  });
});
