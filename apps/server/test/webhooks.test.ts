import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentTokenResponseSchema,
  CommentThreadResponseSchema,
  PageResponseSchema,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookEventSchema,
  WebhookSigningResponseSchema,
  verifyWebhook,
  webhookKeyId,
  type WebhookEvent,
} from '@tablinum/shared';
import { contextOf } from '../src/context.js';
import { createWebhookSender } from '../src/webhooks.js';
import { bodyOf, makeHarness, type Harness } from './support/harness.js';

const SECRET = 'a-signing-secret-long-enough';

interface Delivery {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch that only records. No test in this file reaches the network. */
function recorder(status = 200): { sent: Delivery[]; fetchImpl: typeof fetch } {
  const sent: Delivery[] = [];
  const fetchImpl = ((url: string, init: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init.headers ?? {})) headers[key] = String(value);
    sent.push({ url, headers, body: String(init.body) });
    return Promise.resolve(new Response('', { status }));
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const open: Harness[] = [];

/** A server whose agent webhooks go into `sent` instead of onto the network. */
async function harnessFor(options: { status?: number; secret?: string | null } = {}) {
  const { sent, fetchImpl } = recorder(options.status ?? 200);
  const secret = options.secret === undefined ? SECRET : options.secret;
  const harness = await makeHarness({
    env: {
      TABLINUM_PUBLIC_URL: 'https://docs.example.com',
      ...(secret === null ? {} : { TABLINUM_WEBHOOK_SECRET: secret }),
    },
    webhooks:
      secret === null ? null : createWebhookSender({ secret, log: silentLog(), fetchImpl }),
  });
  open.push(harness);
  return { harness, sent };
}

/** The sender only ever warns, and a passing test has nothing to warn about. */
function silentLog() {
  const noop = (): void => {};
  return { warn: noop, error: noop, info: noop, debug: noop } as unknown as Parameters<
    typeof createWebhookSender
  >[0]['log'];
}

afterEach(async () => {
  while (open.length > 0) {
    const harness = open.pop();
    if (harness !== undefined) await harness.close();
  }
});

/** Wait for every queued delivery, so an assertion never races the notifier. */
async function settle(harness: Harness): Promise<void> {
  await contextOf(harness.app)?.mentions.idle();
}

async function addAgent(harness: Harness, webhookUrl: string | null, name = 'Doc Bot') {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/agents',
    headers: harness.authHeaders(),
    payload: { name, ...(webhookUrl === null ? {} : { webhookUrl }) },
  });
  expect(response.statusCode).toBe(200);
  return bodyOf(response, AgentTokenResponseSchema).agent;
}

/** The first account, and the cookie it writes with. An operator token names nobody. */
async function claim(harness: Harness): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    headers: harness.authHeaders(),
    payload: { email: 'ada@example.com', name: 'Ada Lovelace', password: 'stack-of-pancakes' },
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

async function makeSpace(harness: Harness): Promise<void> {
  await harness.app.inject({
    method: 'POST',
    url: '/api/v1/spaces',
    headers: harness.authHeaders(),
    payload: { slug: 'eng', name: 'Engineering' },
  });
}

async function makePage(harness: Harness, markdown: string) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: harness.authHeaders(),
    payload: { path: 'eng/plan', title: 'The plan', markdown },
  });
  expect(response.statusCode).toBe(201);
  return bodyOf(response, PageResponseSchema).page;
}

function eventOf(delivery: Delivery): WebhookEvent {
  return WebhookEventSchema.parse(JSON.parse(delivery.body));
}

describe('GET /webhooks/signing', () => {
  it('describes the signing scheme without giving the secret away', async () => {
    const { harness } = await harnessFor();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/signing',
      headers: harness.authHeaders(),
    });

    const signing = bodyOf(response, WebhookSigningResponseSchema);
    expect(signing.enabled).toBe(true);
    expect(signing.algorithm).toBe('hmac-sha256');
    expect(signing.keyId).toBe(await webhookKeyId(SECRET));
    expect(signing.signatureHeader).toBe(WEBHOOK_SIGNATURE_HEADER);
    expect(signing.toleranceSeconds).toBeGreaterThan(0);
    expect(response.body).not.toContain(SECRET);
  });

  it('says signing is off when the server has no secret', async () => {
    const { harness } = await harnessFor({ secret: null });
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/signing',
      headers: harness.authHeaders(),
    });

    const signing = bodyOf(response, WebhookSigningResponseSchema);
    expect(signing.enabled).toBe(false);
    expect(signing.keyId).toBeNull();
  });
});

describe('agent webhooks', () => {
  it('posts a signed event when a page tags an agent', async () => {
    const { harness, sent } = await harnessFor();
    const agent = await addAgent(harness, 'https://bot.example.com/hook');
    await makeSpace(harness);
    const page = await makePage(harness, `Please look at this, @${agent.handle}.`);
    await settle(harness);

    expect(sent).toHaveLength(1);
    const delivery = sent[0];
    if (delivery === undefined) throw new Error('nothing was delivered');
    expect(delivery.url).toBe('https://bot.example.com/hook');
    expect(delivery.headers[WEBHOOK_EVENT_HEADER]).toBe('mention.page');

    const event = eventOf(delivery);
    expect(event.type).toBe('mention.page');
    expect(event.id).toBe(delivery.headers[WEBHOOK_DELIVERY_HEADER]);
    expect(event.agent).toEqual({ id: agent.id, name: agent.name, handle: agent.handle });
    expect(event.workspace.id).toBe(harness.deps.accounts.listWorkspaces()[0]?.id);
    expect(event.page.path).toBe(page.path);
    expect(event.page.title).toBe('The plan');
    expect(event.page.url).toBe('https://docs.example.com/p/eng/plan');
    expect(event.thread).toBeNull();
    expect(event.text).toContain(`@${agent.handle}`);
  });

  it('signs the exact bytes it sends, so a receiver can verify them', async () => {
    const { harness, sent } = await harnessFor();
    const agent = await addAgent(harness, 'https://bot.example.com/hook');
    await makeSpace(harness);
    await makePage(harness, `Over to you @${agent.handle}.`);
    await settle(harness);

    const delivery = sent[0];
    if (delivery === undefined) throw new Error('nothing was delivered');
    const signature = delivery.headers[WEBHOOK_SIGNATURE_HEADER] ?? '';
    expect(await verifyWebhook(SECRET, signature, delivery.body)).toBe(true);
    // The body is what was signed, so a single changed character is refused.
    expect(await verifyWebhook(SECRET, signature, `${delivery.body} `)).toBe(false);
    expect(await verifyWebhook('another-signing-secret', signature, delivery.body)).toBe(false);
  });

  it('carries the thread and the writer when the tag is in a comment', async () => {
    const { harness, sent } = await harnessFor();
    const agent = await addAgent(harness, 'https://bot.example.com/hook');
    const cookie = await claim(harness);
    await makeSpace(harness);
    const page = await makePage(harness, 'Nothing yet.');

    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/pages/${page.id}/comments`,
      headers: { cookie },
      payload: { body: `What do you think, @${agent.handle}?` },
    });
    const thread = bodyOf(created, CommentThreadResponseSchema).thread;
    await settle(harness);

    expect(sent).toHaveLength(1);
    const delivery = sent[0];
    if (delivery === undefined) throw new Error('nothing was delivered');
    const event = eventOf(delivery);
    expect(event.type).toBe('mention.comment');
    expect(event.thread?.id).toBe(thread.id);
    expect(event.text).toBe(`What do you think, @${agent.handle}?`);
    expect(event.page.path).toBe(page.path);
    expect(event.by).toEqual({ id: expect.any(String), name: 'Ada Lovelace', handle: 'ada.lovelace' });
  });

  it('says nothing to an agent that has no webhook address', async () => {
    const { harness, sent } = await harnessFor();
    const agent = await addAgent(harness, null);
    await makeSpace(harness);
    await makePage(harness, `Over to you @${agent.handle}.`);
    await settle(harness);

    expect(sent).toHaveLength(0);
  });

  it('says nothing twice about the same handle', async () => {
    const { harness, sent } = await harnessFor();
    const agent = await addAgent(harness, 'https://bot.example.com/hook');
    await makeSpace(harness);
    const page = await makePage(harness, `Over to you @${agent.handle}.`);
    await settle(harness);

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page.id}`,
      headers: harness.authHeaders(),
      payload: { markdown: `Over to you @${agent.handle}. Thank you.` },
    });
    await settle(harness);

    expect(sent).toHaveLength(1);
  });

  it('never tells an agent that belongs to another workspace', async () => {
    const { harness, sent } = await harnessFor();
    const other = harness.accounts.ensureWorkspaceForDir(
      join(harness.root, 'other'),
      'Other',
      'other',
    );
    harness.accounts.createAgent({
      name: 'Other Bot',
      workspaceId: other.id,
      webhookUrl: 'https://other.example.com/hook',
    });
    await makeSpace(harness);
    await makePage(harness, 'Over to you @other.bot.');
    await settle(harness);

    expect(sent).toHaveLength(0);
  });

  it('delivers nothing at all while the server has no signing secret', async () => {
    const { harness, sent } = await harnessFor({ secret: null });
    const agent = await addAgent(harness, 'https://bot.example.com/hook');
    await makeSpace(harness);
    await makePage(harness, `Over to you @${agent.handle}.`);
    await settle(harness);

    expect(sent).toHaveLength(0);
  });

  it('keeps the page even when the receiver refuses the delivery', async () => {
    const { harness, sent } = await harnessFor({ status: 500 });
    const agent = await addAgent(harness, 'https://bot.example.com/hook');
    await makeSpace(harness);
    const page = await makePage(harness, `Over to you @${agent.handle}.`);
    await settle(harness);

    expect(sent).toHaveLength(1);
    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${page.id}`,
      headers: harness.authHeaders(),
    });
    expect(read.statusCode).toBe(200);
  });
});
