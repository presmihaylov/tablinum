import { afterEach, describe, expect, it } from 'vitest';
import { PageResponseSchema, SlackStateResponseSchema } from '@tablinum/shared';
import { contextOf } from '../src/context.js';
import type { SlackApi } from '../src/slack.js';
import { bodyOf, makeHarness, TEST_TOKEN, type Harness } from './support/harness.js';

interface SentMessage {
  userId: string;
  text: string;
}

interface SlackStub extends SlackApi {
  sent: SentMessage[];
  byEmail: Map<string, string>;
}

/** A Slack that only records. No test ever reaches slack.com. */
function slackStub(): SlackStub {
  const sent: SentMessage[] = [];
  const byEmail = new Map<string, string>();
  return {
    sent,
    byEmail,
    lookupByEmail: (email: string) => Promise.resolve(byEmail.get(email) ?? null),
    postMessage: (userId: string, text: string) => {
      sent.push({ userId, text });
      return Promise.resolve(true);
    },
  };
}

const open: Harness[] = [];

async function harnessFor(options: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const harness = await makeHarness(options);
  open.push(harness);
  return harness;
}

afterEach(async () => {
  while (open.length > 0) {
    const harness = open.pop();
    if (harness !== undefined) await harness.close();
  }
});

const ADMIN = { email: 'ada@example.com', name: 'Ada Lovelace', password: 'stack-of-pancakes' };

function cookiePair(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

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

/** Wait for every queued notification, so an assertion never races the delivery. */
async function settle(harness: Harness): Promise<void> {
  await contextOf(harness.app)?.mentions.idle();
}

describe('GET and DELETE /me/slack', () => {
  it('reports Slack as unconfigured when the server has no token', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me/slack',
      headers: { cookie },
    });
    const state = bodyOf(response, SlackStateResponseSchema);
    expect(state).toEqual({ configured: false, connected: false, slackUserId: null });
  });

  it('refuses to connect without a bot token', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/slack',
      headers: { cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('POST /me/slack', () => {
  it('finds the member id from the email address', async () => {
    const slack = slackStub();
    slack.byEmail.set(ADMIN.email, 'U01ABCDEF');
    const harness = await harnessFor({ slack });
    const cookie = await claim(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/slack',
      headers: { cookie },
      payload: {},
    });
    expect(bodyOf(response, SlackStateResponseSchema)).toEqual({
      configured: true,
      connected: true,
      slackUserId: 'U01ABCDEF',
    });
  });

  it('takes a member id that is pasted in, and uppercases it', async () => {
    const harness = await harnessFor({ slack: slackStub() });
    const cookie = await claim(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/slack',
      headers: { cookie },
      payload: { slackUserId: ' u01abcdef ' },
    });
    expect(bodyOf(response, SlackStateResponseSchema).slackUserId).toBe('U01ABCDEF');
  });

  it('refuses something that is not a member id', async () => {
    const harness = await harnessFor({ slack: slackStub() });
    const cookie = await claim(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/slack',
      headers: { cookie },
      payload: { slackUserId: 'not-a-member' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('says so when Slack knows no member with that address', async () => {
    const harness = await harnessFor({ slack: slackStub() });
    const cookie = await claim(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/slack',
      headers: { cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });

  it('disconnects again', async () => {
    const harness = await harnessFor({ slack: slackStub() });
    const cookie = await claim(harness);
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/slack',
      headers: { cookie },
      payload: { slackUserId: 'U01ABCDEF' },
    });

    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/me/slack',
      headers: { cookie },
    });
    expect(bodyOf(response, SlackStateResponseSchema).connected).toBe(false);
  });
});

/** An admin, a second account with Slack connected, and the admin's cookie. */
async function twoPeople(harness: Harness): Promise<{ cookie: string; samId: string }> {
  const cookie = await claim(harness);
  const sam = harness.accounts.createUser({
    email: 'sam@example.com',
    name: 'Sam Rivers',
    password: 'another long passphrase',
  });
  harness.accounts.setSlackUserId(sam.id, 'U0SAM0000');
  return { cookie, samId: sam.id };
}

describe('mention notifications', () => {
  it('sends a direct message when a new page names somebody', async () => {
    const slack = slackStub();
    const harness = await harnessFor({ slack, env: { TABLINUM_PUBLIC_URL: 'https://docs.example.com/' } });
    const { cookie } = await twoPeople(harness);

    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { cookie },
      payload: { slug: 'eng', name: 'Engineering' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: { cookie },
      payload: { path: 'eng/plan', title: 'The plan', markdown: 'Ask @sam.rivers about it.' },
    });
    await settle(harness);

    expect(slack.sent).toHaveLength(1);
    expect(slack.sent[0]?.userId).toBe('U0SAM0000');
    expect(slack.sent[0]?.text).toContain('Ada Lovelace');
    expect(slack.sent[0]?.text).toContain('The plan');
    expect(slack.sent[0]?.text).toContain('https://docs.example.com/p/eng/plan');
  });

  it('tells only the handles a save adds', async () => {
    const slack = slackStub();
    const harness = await harnessFor({ slack });
    const { cookie } = await twoPeople(harness);
    const grace = harness.accounts.createUser({
      email: 'grace@example.com',
      name: 'Grace Hopper',
      password: 'a third long passphrase',
    });
    harness.accounts.setSlackUserId(grace.id, 'U0GRACE00');

    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { cookie },
      payload: { slug: 'eng', name: 'Engineering' },
    });
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: { cookie },
      payload: { path: 'eng/plan', title: 'The plan', markdown: 'Ask @sam.rivers.' },
    });
    const page = bodyOf(created, PageResponseSchema).page;
    await settle(harness);
    slack.sent.length = 0;

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page.id}`,
      headers: { cookie },
      payload: { markdown: 'Ask @sam.rivers and @grace.hopper.', rev: page.rev },
    });
    await settle(harness);

    expect(slack.sent.map((entry) => entry.userId)).toEqual(['U0GRACE00']);
  });

  it('never tells you about your own mention', async () => {
    const slack = slackStub();
    const harness = await harnessFor({ slack });
    const cookie = await claim(harness);
    const me = harness.accounts.getUserByEmail(ADMIN.email);
    harness.accounts.setSlackUserId(me?.id ?? '', 'U0ADA0000');

    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { cookie },
      payload: { slug: 'eng', name: 'Engineering' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: { cookie },
      payload: { path: 'eng/plan', title: 'The plan', markdown: `Ask @${me?.handle ?? ''}.` },
    });
    await settle(harness);

    expect(slack.sent).toHaveLength(0);
  });

  it('says nothing about a mention inside code, or about an unknown handle', async () => {
    const slack = slackStub();
    const harness = await harnessFor({ slack });
    const { cookie } = await twoPeople(harness);

    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { cookie },
      payload: { slug: 'eng', name: 'Engineering' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: { cookie },
      payload: {
        path: 'eng/plan',
        title: 'The plan',
        markdown: 'Run `ping @sam.rivers` and ask @nobody.here.',
      },
    });
    await settle(harness);

    expect(slack.sent).toHaveLength(0);
  });

  it('keeps the save working when Slack throws', async () => {
    const slack: SlackApi = {
      lookupByEmail: () => Promise.resolve(null),
      postMessage: () => Promise.reject(new Error('slack is down')),
    };
    const harness = await harnessFor({ slack });
    const { cookie } = await twoPeople(harness);

    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { cookie },
      payload: { slug: 'eng', name: 'Engineering' },
    });
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: { cookie },
      payload: { path: 'eng/plan', title: 'The plan', markdown: 'Ask @sam.rivers.' },
    });

    expect(created.statusCode).toBe(201);
    await expect(settle(harness)).resolves.toBeUndefined();
  });
});
