import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_HEADER, PageResponseSchema } from '@tablinum/shared';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

async function createPage(markdown: string) {
  const reply = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: harness.authHeaders(),
    payload: { path: 'eng/notes', title: 'Notes', markdown },
  });
  return bodyOf(reply, PageResponseSchema).page;
}

function patch(id: string, payload: Record<string, unknown>, client = 'tab-1') {
  return harness.app.inject({
    method: 'PATCH',
    url: `/api/v1/pages/${id}`,
    headers: { ...harness.authHeaders(), [CLIENT_HEADER]: client },
    payload,
  });
}

describe('concurrent writes to one page', () => {
  it('lands every writer when each owns a different line', async () => {
    await seed(harness);
    const writers = 10;
    const lines = Array.from({ length: writers }, (_, i) => `w${i}:`);
    const page = await createPage(lines.join('\n'));

    const replies = await Promise.all(
      Array.from({ length: writers }, (_, i) => {
        const next = [...lines];
        next[i] = `w${i}: edited`;
        return patch(page.id, { markdown: next.join('\n'), baseRev: page.rev }, `tab-${i}`);
      }),
    );

    expect(replies.every((reply) => reply.statusCode === 200)).toBe(true);

    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${page.id}`,
      headers: harness.authHeaders(),
    });
    const final = bodyOf(read, PageResponseSchema).page;
    for (let i = 0; i < writers; i += 1) {
      expect(final.markdown).toContain(`w${i}: edited`);
    }
  });

  it('never answers 404 for a page that is being written', async () => {
    await seed(harness);
    const page = await createPage('start');

    const writes = Array.from({ length: 10 }, (_, i) =>
      patch(page.id, { markdown: `body ${i}` }, `tab-${i}`),
    );
    const reads = Array.from({ length: 20 }, () =>
      harness.app.inject({
        method: 'GET',
        url: `/api/v1/pages/${page.id}`,
        headers: harness.authHeaders(),
      }),
    );

    const replies = await Promise.all([...writes, ...reads]);
    expect(replies.filter((reply) => reply.statusCode === 404)).toHaveLength(0);
  });

  it('serialises the writes rather than interleaving them', async () => {
    await seed(harness);
    const page = await createPage('0');

    // Each writer appends one line without a baseRev, so the file is rewritten every time.
    // If two writes interleaved, the read-back would show a body that no writer ever sent.
    const replies = await Promise.all(
      Array.from({ length: 10 }, (_, i) => patch(page.id, { markdown: `body ${i}` }, `tab-${i}`)),
    );
    expect(replies.every((reply) => reply.statusCode === 200)).toBe(true);

    const bodies = replies.map((reply) => bodyOf(reply, PageResponseSchema).page.markdown);
    for (const body of bodies) {
      expect(body).toMatch(/^body \d+$/);
    }
    const revs = new Set(replies.map((reply) => bodyOf(reply, PageResponseSchema).page.rev));
    // Distinct bodies must produce distinct revs; a shared rev would mean a lost write.
    expect(revs.size).toBe(new Set(bodies).size);
  });

  it('refuses only a genuine overlap', async () => {
    await seed(harness);
    const page = await createPage('alpha\nbravo\ncharlie');

    const landed = await patch(page.id, { markdown: 'alpha\nTHEIRS\ncharlie' });
    expect(landed.statusCode).toBe(200);

    const clash = await patch(page.id, {
      markdown: 'alpha\nOURS\ncharlie',
      baseRev: page.rev,
    });
    expect(clash.statusCode).toBe(409);

    const apart = await patch(page.id, {
      markdown: 'ALPHA\nbravo\ncharlie',
      baseRev: page.rev,
    });
    expect(apart.statusCode).toBe(200);
  });
});
