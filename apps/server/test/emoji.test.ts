import { afterEach, describe, expect, it } from 'vitest';
import {
  CustomEmojiListResponseSchema,
  CustomEmojiResponseSchema,
  ErrorBodySchema,
  InviteResponseSchema,
  MAX_CUSTOM_EMOJI_BYTES,
  OkResponseSchema,
} from '@tablinum/shared';
import { bodyOf, makeHarness, TEST_TOKEN, type Harness } from './support/harness.js';
import { multipart } from './support/multipart.js';

const open: Harness[] = [];

async function harnessFor(): Promise<Harness> {
  const harness = await makeHarness({});
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

/** Claim the server with the first admin and return the cookie that account signs in with. */
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

/** Invite somebody, register them and return the cookie of the new member. */
async function joinAsMember(harness: Harness, admin: string, email: string): Promise<string> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/invites',
    headers: { cookie: admin },
    payload: { email },
  });
  expect(created.statusCode).toBe(200);
  const issued = bodyOf(created, InviteResponseSchema);
  const token = issued.url.slice(issued.url.lastIndexOf('/') + 1);

  const registered = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { token, name: 'Grace Hopper', password: 'nanoseconds-please' },
  });
  expect(registered.statusCode).toBe(200);
  return cookiePair(registered);
}

/** A 1x1 png, small enough to be an emoji and real enough to be sniffed. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function upload(shortcode: string, data: Buffer, contentType = 'image/png') {
  return multipart({ fields: { shortcode }, filename: 'emoji.png', contentType, data });
}

async function post(harness: Harness, cookie: string, shortcode: string, data: Buffer = PNG) {
  const form = upload(shortcode, data);
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/emoji',
    headers: { ...form.headers, cookie },
    payload: form.payload,
  });
}

describe('custom emoji', () => {
  it('uploads one, lists it and serves the image', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const created = await post(harness, cookie, 'Parrot');
    expect(created.statusCode).toBe(200);
    const emoji = bodyOf(created, CustomEmojiResponseSchema).emoji;
    expect(emoji.shortcode).toBe('parrot');
    expect(emoji.mime).toBe('image/png');

    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/emoji', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(bodyOf(listed, CustomEmojiListResponseSchema).emoji).toHaveLength(1);

    const image = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/emoji/parrot/image',
      headers: { cookie },
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.rawPayload.equals(PNG)).toBe(true);
  });

  it('refuses an image that is too large', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const response = await post(harness, cookie, 'huge', Buffer.alloc(MAX_CUSTOM_EMOJI_BYTES + 1));
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('refuses bytes that are not an image, whatever the upload calls them', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const response = await post(harness, cookie, 'prose', Buffer.from('%PDF-1.7 not an image'));
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('refuses a shortcode that is already taken', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    expect((await post(harness, cookie, 'parrot')).statusCode).toBe(200);

    const again = await post(harness, cookie, 'parrot');
    expect(again.statusCode).toBe(409);
    expect(bodyOf(again, ErrorBodySchema).error.code).toBe('CONFLICT');
  });

  it('lets a member delete their own', async () => {
    const harness = await harnessFor();
    const admin = await claim(harness);
    const member = await joinAsMember(harness, admin, 'grace@example.com');

    const created = await post(harness, member, 'parrot');
    const emoji = bodyOf(created, CustomEmojiResponseSchema).emoji;

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/emoji/${emoji.id}`,
      headers: { cookie: member },
    });
    expect(removed.statusCode).toBe(200);
    expect(bodyOf(removed, OkResponseSchema).ok).toBe(true);
  });

  it('stops a member deleting somebody else, and lets an admin do it', async () => {
    const harness = await harnessFor();
    const admin = await claim(harness);
    const member = await joinAsMember(harness, admin, 'grace@example.com');

    const created = await post(harness, admin, 'parrot');
    const emoji = bodyOf(created, CustomEmojiResponseSchema).emoji;

    const denied = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/emoji/${emoji.id}`,
      headers: { cookie: member },
    });
    expect(denied.statusCode).toBe(401);
    expect(bodyOf(denied, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');

    const allowed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/emoji/${emoji.id}`,
      headers: { cookie: admin },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('turns away a caller with no credentials', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const created = await post(harness, cookie, 'parrot');
    const emoji = bodyOf(created, CustomEmojiResponseSchema).emoji;

    const form = upload('sneaky', PNG);
    const anonymous = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/emoji',
      headers: form.headers,
      payload: form.payload,
    });
    expect(anonymous.statusCode).toBe(401);

    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/emoji' });
    expect(listed.statusCode).toBe(401);

    const removed = await harness.app.inject({ method: 'DELETE', url: `/api/v1/emoji/${emoji.id}` });
    expect(removed.statusCode).toBe(401);
  });

  it('has nothing to serve for a shortcode nobody uploaded', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const missing = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/emoji/nope/image',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(bodyOf(missing, ErrorBodySchema).error.code).toBe('NOT_FOUND');
  });
});
