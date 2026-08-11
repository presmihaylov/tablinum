import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_TOLERANCE_SECONDS,
  WebhookEventSchema,
  WebhookUrlSchema,
  newDeliveryId,
  signWebhook,
  signedPayload,
  verifyWebhook,
  webhookKeyId,
} from '../src/webhooks.js';

const SECRET = 'a-signing-secret-long-enough';
const BODY = '{"hello":"world"}';
const NOW = 1_770_000_000;

describe('WebhookUrlSchema', () => {
  it('accepts an http and an https address, and trims it', () => {
    expect(WebhookUrlSchema.parse('https://example.com/hook')).toBe('https://example.com/hook');
    expect(WebhookUrlSchema.parse('  http://localhost:9000/x  ')).toBe('http://localhost:9000/x');
  });

  it('refuses anything that is not a delivery address', () => {
    expect(WebhookUrlSchema.safeParse('example.com/hook').success).toBe(false);
    expect(WebhookUrlSchema.safeParse('/relative').success).toBe(false);
    expect(WebhookUrlSchema.safeParse('ftp://example.com').success).toBe(false);
    expect(WebhookUrlSchema.safeParse('').success).toBe(false);
  });
});

describe('signWebhook', () => {
  it('signs the timestamp and the body together', async () => {
    const header = await signWebhook(SECRET, NOW, BODY);
    expect(header).toMatch(/^t=1770000000,v1=[0-9a-f]{64}$/);
    expect(signedPayload(NOW, BODY)).toBe(`${NOW}.${BODY}`);
  });

  it('gives the same signature for the same inputs every time', async () => {
    expect(await signWebhook(SECRET, NOW, BODY)).toBe(await signWebhook(SECRET, NOW, BODY));
  });
});

describe('verifyWebhook', () => {
  it('accepts a signature this secret made over this body', async () => {
    const header = await signWebhook(SECRET, NOW, BODY);
    expect(await verifyWebhook(SECRET, header, BODY, NOW)).toBe(true);
  });

  it('refuses another secret, another body and a changed timestamp', async () => {
    const header = await signWebhook(SECRET, NOW, BODY);
    expect(await verifyWebhook('another-signing-secret', header, BODY, NOW)).toBe(false);
    expect(await verifyWebhook(SECRET, header, '{"hello":"there"}', NOW)).toBe(false);
    expect(await verifyWebhook(SECRET, header.replace('t=1770000000', 't=1770000001'), BODY, NOW)).toBe(
      false,
    );
  });

  it('refuses a delivery that is older than the tolerance', async () => {
    const header = await signWebhook(SECRET, NOW, BODY);
    const late = NOW + WEBHOOK_TOLERANCE_SECONDS + 1;
    expect(await verifyWebhook(SECRET, header, BODY, NOW + WEBHOOK_TOLERANCE_SECONDS)).toBe(true);
    expect(await verifyWebhook(SECRET, header, BODY, late)).toBe(false);
  });

  it('refuses a header it cannot read', async () => {
    expect(await verifyWebhook(SECRET, '', BODY, NOW)).toBe(false);
    expect(await verifyWebhook(SECRET, 'v1=abc', BODY, NOW)).toBe(false);
    expect(await verifyWebhook(SECRET, 't=nonsense,v1=abc', BODY, NOW)).toBe(false);
  });
});

describe('webhookKeyId', () => {
  it('names a secret without revealing it', async () => {
    const id = await webhookKeyId(SECRET);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(SECRET).not.toContain(id);
    expect(await webhookKeyId(SECRET)).toBe(id);
    expect(await webhookKeyId('another-signing-secret')).not.toBe(id);
  });
});

describe('newDeliveryId', () => {
  it('is unique per delivery and carries its own prefix', () => {
    const one = newDeliveryId();
    expect(one.startsWith('whd_')).toBe(true);
    expect(newDeliveryId()).not.toBe(one);
  });
});

describe('WebhookEventSchema', () => {
  const EVENT = {
    id: 'whd_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    type: 'mention.comment' as const,
    created: '2026-01-01T00:00:00.000Z',
    agent: { id: 'ag_1', name: 'Doc Bot', handle: 'doc.bot' },
    workspace: { id: 'ws_00000000000000000000000001', slug: 'main', name: 'Main' },
    page: { id: 'pg_1', path: 'eng/plan', title: 'The plan', url: 'https://docs.example.com/p/eng/plan' },
    by: { id: 'us_1', name: 'Ada Lovelace', handle: 'ada.lovelace' },
    thread: { id: 'th_1' },
    text: 'Take a look @doc.bot',
  };

  it('reads a full event', () => {
    expect(WebhookEventSchema.parse(EVENT)).toEqual(EVENT);
  });

  it('reads a page mention, where there is no thread and nobody wrote it', () => {
    const parsed = WebhookEventSchema.parse({
      ...EVENT,
      type: 'mention.page',
      by: null,
      thread: null,
      page: { ...EVENT.page, url: null },
    });
    expect(parsed.thread).toBeNull();
    expect(parsed.by).toBeNull();
  });

  it('refuses an event type it does not know', () => {
    expect(WebhookEventSchema.safeParse({ ...EVENT, type: 'page.deleted' }).success).toBe(false);
  });
});
