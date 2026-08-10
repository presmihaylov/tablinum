import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentTokenResponseSchema,
  AuthResponseSchema,
  CommentThreadResponseSchema,
  CommentThreadsResponseSchema,
  DeleteCommentResponseSchema,
  ErrorBodySchema,
  InviteResponseSchema,
  MAX_COMMENT_LENGTH,
  WORKSPACE_HEADER,
  WorkspaceResponseSchema,
  type CommentAnchor,
} from '@tablinum/shared';
import { bodyOf, makeHarness, seed, TEST_TOKEN, type Harness } from './support/harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

const ADMIN = { email: 'ada@example.com', name: 'Ada Lovelace', password: 'stack-of-pancakes' };
const ANCHOR: CommentAnchor = { quote: 'Run the pipeline', prefix: 'Deploy\n', suffix: '.', start: 8 };

function cookiePair(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

/** Claim the server with the first admin and return the cookie that account signs in with. */
async function claim(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    payload: ADMIN,
  });
  expect(response.statusCode).toBe(200);
  return cookiePair(response);
}

/** Invite somebody into the workspace the admin is in, and sign them in. */
async function invite(adminCookie: string, name: string, email: string): Promise<string> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/invites',
    headers: { cookie: adminCookie },
    payload: { email },
  });
  const issued = bodyOf(created, InviteResponseSchema);
  const token = issued.url.slice(issued.url.lastIndexOf('/') + 1);

  const registered = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { token, name, password: 'nanoseconds-please' },
  });
  expect(bodyOf(registered, AuthResponseSchema).user?.role).toBe('member');
  return cookiePair(registered);
}

/** A page to talk about, plus the admin cookie that made it. */
async function pageWithAdmin(): Promise<{ cookie: string; pageId: string }> {
  const cookie = await claim();
  const { pageIds } = await seed(harness);
  const pageId = pageIds[0];
  if (pageId === undefined) throw new Error('The seed made no page');
  return { cookie, pageId };
}

async function openThread(cookie: string, pageId: string, body: string, anchor?: CommentAnchor) {
  const payload = anchor === undefined ? { body } : { body, anchor };
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/v1/pages/${pageId}/comments`,
    headers: { cookie },
    payload,
  });
  expect(response.statusCode).toBe(201);
  return bodyOf(response, CommentThreadResponseSchema).thread;
}

async function listThreads(cookie: string, pageId: string, query = '') {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/pages/${pageId}/comments${query}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return bodyOf(response, CommentThreadsResponseSchema).threads;
}

describe('comments', () => {
  it('runs the whole conversation: open, reply, resolve, reopen', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');

    const thread = await openThread(cookie, pageId, 'Is this still the right pipeline?', ANCHOR);
    expect(thread.pageId).toBe(pageId);
    expect(thread.anchor).toEqual(ANCHOR);
    expect(thread.resolved).toBe(false);
    expect(thread.comments).toHaveLength(1);

    const replied = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/comment-threads/${thread.id}/replies`,
      headers: { cookie: member },
      payload: { body: 'It is. I checked on Monday.' },
    });
    expect(replied.statusCode).toBe(201);
    const withReply = bodyOf(replied, CommentThreadResponseSchema).thread;
    expect(withReply.comments.map((one) => one.body)).toEqual([
      'Is this still the right pipeline?',
      'It is. I checked on Monday.',
    ]);

    const resolved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comment-threads/${thread.id}`,
      headers: { cookie: member },
      payload: { resolved: true },
    });
    expect(bodyOf(resolved, CommentThreadResponseSchema).thread.resolved).toBe(true);

    expect(await listThreads(cookie, pageId, '?resolved=true')).toHaveLength(1);
    expect(await listThreads(cookie, pageId, '?resolved=false')).toHaveLength(0);

    const reopened = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comment-threads/${thread.id}`,
      headers: { cookie },
      payload: { resolved: false },
    });
    const back = bodyOf(reopened, CommentThreadResponseSchema).thread;
    expect(back.resolved).toBe(false);
    expect(back.resolvedBy).toBeNull();
  });

  it('takes a comment about the whole page, with no anchor', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const thread = await openThread(cookie, pageId, 'This page needs an owner');
    expect(thread.anchor).toBeNull();
  });

  it('survives a reload: the threads come back from the database', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    await openThread(cookie, pageId, 'One', ANCHOR);
    await openThread(cookie, pageId, 'Two');

    const threads = await listThreads(cookie, pageId);
    expect(threads.map((one) => one.comments[0]?.body)).toEqual(['One', 'Two']);
    expect(threads[0]?.anchor?.quote).toBe(ANCHOR.quote);
  });

  it('refuses a body that is empty or longer than the limit', async () => {
    const { cookie, pageId } = await pageWithAdmin();

    for (const body of ['   ', 'x'.repeat(MAX_COMMENT_LENGTH + 1)]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/pages/${pageId}/comments`,
        headers: { cookie },
        payload: { body },
      });
      expect(response.statusCode).toBe(400);
      expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
    }
  });

  it('answers NOT_FOUND for a page nobody has', async () => {
    const cookie = await claim();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages/pg_01J8XYZABCDEFGHJKMNPQRSTV/comments',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('comment permissions', () => {
  it('turns an unauthenticated caller away', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const thread = await openThread(cookie, pageId, 'One');

    const read = await harness.app.inject({ method: 'GET', url: `/api/v1/pages/${pageId}/comments` });
    expect(read.statusCode).toBe(401);

    const write = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/comment-threads/${thread.id}/replies`,
      payload: { body: 'Let me in' },
    });
    expect(write.statusCode).toBe(401);
  });

  it('lets a machine credential read comments but never write one', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    await openThread(cookie, pageId, 'One');

    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${pageId}/comments`,
      headers: harness.authHeaders(),
    });
    expect(read.statusCode).toBe(200);

    const written = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/pages/${pageId}/comments`,
      headers: harness.authHeaders(),
      payload: { body: 'A comment names a person' },
    });
    expect(written.statusCode).toBe(401);
  });

  it('keeps a member out of a workspace they are not in', async () => {
    const cookie = await claim();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie },
      payload: { name: 'Handbook' },
    });
    const other = bodyOf(created, WorkspaceResponseSchema).workspace;

    const pages = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: { cookie, [WORKSPACE_HEADER]: other.slug },
    });
    const record: unknown = JSON.parse(pages.body);
    const first =
      typeof record === 'object' && record !== null && 'pages' in record
        ? (record as { pages: Array<{ id: string }> }).pages[0]
        : undefined;
    if (first === undefined) throw new Error('The new workspace has no home page');

    const denied = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${first.id}/comments`,
      headers: { cookie: member, [WORKSPACE_HEADER]: other.slug },
    });
    expect(denied.statusCode).toBe(401);
    expect(bodyOf(denied, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');
  });

  it('hides a thread from every other workspace, id or no id', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const thread = await openThread(cookie, pageId, 'One', ANCHOR);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie },
      payload: { name: 'Handbook' },
    });
    const other = bodyOf(created, WorkspaceResponseSchema).workspace;
    const elsewhere = { cookie, [WORKSPACE_HEADER]: other.slug };

    // The admin may open both workspaces, so only the workspace filter can refuse this.
    const page = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${pageId}/comments`,
      headers: elsewhere,
    });
    expect(page.statusCode).toBe(404);

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comment-threads/${thread.id}`,
      headers: elsewhere,
      payload: { resolved: true },
    });
    expect(patched.statusCode).toBe(404);

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${thread.comments[0]?.id}`,
      headers: elsewhere,
    });
    expect(removed.statusCode).toBe(404);
  });
});

describe('an agent in the conversation', () => {
  /** An agent credential in the workspace the admin already claimed. */
  async function addAgent(cookie: string, name = 'Doc Bot'): Promise<string> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { cookie },
      payload: { name, identity: 'You keep the runbooks tidy.' },
    });
    expect(response.statusCode).toBe(200);
    return bodyOf(response, AgentTokenResponseSchema).token;
  }

  it('writes a thread under its own name, and a person reads it', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const token = await addAgent(cookie);
    const agents = harness.accounts.listAgents(harness.accounts.listWorkspaces()[0]?.id ?? '');
    const agentId = agents[0]?.id;

    const written = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/pages/${pageId}/comments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { body: 'This runbook still names the old queue.', anchor: ANCHOR },
    });
    expect(written.statusCode).toBe(201);
    const thread = bodyOf(written, CommentThreadResponseSchema).thread;
    expect(thread.comments[0]?.author).toBe(agentId);

    // The remark is a normal thread: it reaches the panel a person is reading.
    const seen = await listThreads(cookie, pageId);
    expect(seen.map((one) => one.id)).toContain(thread.id);
  });

  it('replies to a thread a person opened, and resolves it', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const token = await addAgent(cookie);
    const headers = { authorization: `Bearer ${token}` };
    const thread = await openThread(cookie, pageId, 'Please add the rollback step.', ANCHOR);

    const replied = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/comment-threads/${thread.id}/replies`,
      headers,
      payload: { body: 'Added it under "Rollback".' },
    });
    expect(replied.statusCode).toBe(201);
    expect(bodyOf(replied, CommentThreadResponseSchema).thread.comments).toHaveLength(2);

    const resolved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comment-threads/${thread.id}`,
      headers,
      payload: { resolved: true },
    });
    expect(resolved.statusCode).toBe(200);
    expect(bodyOf(resolved, CommentThreadResponseSchema).thread.resolved).toBe(true);
  });

  it('rewords and takes back its own remark, and no remark of a person', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const token = await addAgent(cookie);
    const headers = { authorization: `Bearer ${token}` };
    const mine = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/pages/${pageId}/comments`,
      headers,
      payload: { body: 'A first draft of the remark.' },
    });
    const written = bodyOf(mine, CommentThreadResponseSchema).thread;
    const commentId = written.comments[0]?.id;

    const reworded = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comments/${commentId}`,
      headers,
      payload: { body: 'A clearer second draft.' },
    });
    expect(reworded.statusCode).toBe(200);
    expect(bodyOf(reworded, CommentThreadResponseSchema).thread.comments[0]?.body).toBe(
      'A clearer second draft.',
    );

    const theirs = await openThread(cookie, pageId, "A person's remark.");
    const refused = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comments/${theirs.comments[0]?.id}`,
      headers,
      payload: { body: 'Not yours to reword.' },
    });
    expect(refused.statusCode).toBe(401);

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${commentId}`,
      headers,
    });
    expect(removed.statusCode).toBe(200);
    expect(bodyOf(removed, DeleteCommentResponseSchema).thread).toBeNull();
  });
});

describe('editing and deleting a comment', () => {
  it('lets the author rewrite their own comment and nobody else', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');
    const thread = await openThread(cookie, pageId, 'Is this right?');
    const commentId = thread.comments[0]?.id;

    const mine = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comments/${commentId}`,
      headers: { cookie },
      payload: { body: 'Is this still right?' },
    });
    const edited = bodyOf(mine, CommentThreadResponseSchema).thread;
    expect(edited.comments[0]?.body).toBe('Is this still right?');
    expect(edited.comments[0]?.updated).not.toBe(edited.comments[0]?.created);

    const theirs = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comments/${commentId}`,
      headers: { cookie: member },
      payload: { body: 'I speak for you now' },
    });
    expect(theirs.statusCode).toBe(401);
  });

  it('refuses an admin who tries to reword somebody else', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');
    const thread = await openThread(member, pageId, 'A member wrote this');

    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/comments/${thread.comments[0]?.id}`,
      headers: { cookie },
      payload: { body: 'An admin rewrote this' },
    });
    expect(response.statusCode).toBe(401);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');
  });

  it('refuses a member who deletes somebody else, and allows an admin', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');
    const thread = await openThread(cookie, pageId, 'An admin wrote this');
    const commentId = thread.comments[0]?.id;

    const denied = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${commentId}`,
      headers: { cookie: member },
    });
    expect(denied.statusCode).toBe(401);
    expect(await listThreads(cookie, pageId)).toHaveLength(1);

    const allowed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${commentId}`,
      headers: { cookie },
    });
    expect(allowed.statusCode).toBe(200);
    // The opening comment went, so the thread went with it.
    expect(bodyOf(allowed, DeleteCommentResponseSchema).thread).toBeNull();
    expect(await listThreads(cookie, pageId)).toHaveLength(0);
  });

  it('lets an admin take one reply down and leaves the thread standing', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');
    const thread = await openThread(cookie, pageId, 'One');

    const replied = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/comment-threads/${thread.id}/replies`,
      headers: { cookie: member },
      payload: { body: 'Two' },
    });
    const withReply = bodyOf(replied, CommentThreadResponseSchema).thread;

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${withReply.comments[1]?.id}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);
    const left = bodyOf(removed, DeleteCommentResponseSchema).thread;
    expect(left?.comments.map((one) => one.body)).toEqual(['One']);
  });

  it('lets a member delete their own reply', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');
    const thread = await openThread(cookie, pageId, 'One');

    const replied = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/comment-threads/${thread.id}/replies`,
      headers: { cookie: member },
      payload: { body: 'Two' },
    });
    const withReply = bodyOf(replied, CommentThreadResponseSchema).thread;

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${withReply.comments[1]?.id}`,
      headers: { cookie: member },
    });
    expect(removed.statusCode).toBe(200);
    expect(bodyOf(removed, DeleteCommentResponseSchema).thread?.comments).toHaveLength(1);
  });
});

describe('a deleted page', () => {
  it('takes its threads with it', async () => {
    const { cookie, pageId } = await pageWithAdmin();
    await openThread(cookie, pageId, 'One', ANCHOR);
    await openThread(cookie, pageId, 'Two');

    const workspaceId = harness.accounts.listWorkspaces()[0]?.id;
    if (workspaceId === undefined) throw new Error('The server has no workspace');
    expect(harness.accounts.listThreads(workspaceId, pageId)).toHaveLength(2);

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${pageId}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);
    expect(harness.accounts.listThreads(workspaceId, pageId)).toEqual([]);
  });
});
