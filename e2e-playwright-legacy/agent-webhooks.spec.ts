import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, uniqueSlug } from './fixtures';
import { WEBHOOK_SECRET } from './env';

/**
 * Agent webhooks.
 *
 * An agent has no inbox, so a tag reaches it over HTTP. This stands a real receiver, gives an
 * agent its address through the settings page, and checks that the delivery arrives signed with
 * the secret the server was started with.
 */

interface Delivery {
  headers: Record<string, string>;
  body: string;
}

/** A receiver on a free port. Every delivery it takes lands in `sent`. */
async function receiver(): Promise<{ url: string; sent: Delivery[]; close: () => Promise<void> }> {
  const sent: Delivery[] = [];
  const server: Server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) headers[key] = String(value);
      sent.push({ headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200).end('ok');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    sent,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Exactly what the README tells a customer to write. */
function verify(secret: string, header: string, rawBody: string): boolean {
  const fields = new Map(header.split(',').map((part) => part.split('=') as [string, string]));
  const timestamp = fields.get('t') ?? '';
  const signature = fields.get('v1') ?? '';
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const wanted = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  if (wanted.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(wanted), Buffer.from(signature));
}

test.describe('agent webhooks', () => {
  test('posts a signed event to the address the agent was given', async ({ page, api }) => {
    const hook = await receiver();
    const name = `Hook Bot ${uniqueSlug('w')}`;

    try {
      await page.goto('/settings/agents');
      await page.getByLabel('Agent name').fill(name);
      await page.getByLabel('Agent webhook URL').fill(hook.url);
      // The server was started with a secret, so the page says how a delivery is signed.
      await expect(page.getByText(/hmac-sha256/)).toBeVisible();
      await page.getByRole('button', { name: 'Add agent' }).click();
      await page.getByRole('button', { name: 'I have copied it' }).click();

      const row = page.locator('.people-row').filter({ hasText: name });
      await expect(row).toContainText('notified by webhook');
      const handle = (await row.locator('.people-row__email').textContent())?.match(
        /@([a-z0-9._-]+)/,
      )?.[1];
      expect(handle).toBeTruthy();

      const space = await api.createUniqueSpace('hook');
      const page_ = await api.createPage({
        path: `${space.slug}/brief`,
        title: 'The brief',
        markdown: `Please take this on, @${handle ?? ''}.`,
      });

      await expect.poll(() => hook.sent.length, { timeout: 15_000 }).toBe(1);
      const delivery = hook.sent[0];
      if (delivery === undefined) throw new Error('nothing was delivered');

      expect(verify(WEBHOOK_SECRET, delivery.headers['x-tablinum-signature'] ?? '', delivery.body)).toBe(
        true,
      );
      expect(verify('the-wrong-secret-entirely', delivery.headers['x-tablinum-signature'] ?? '', delivery.body)).toBe(
        false,
      );
      expect(delivery.headers['x-tablinum-event']).toBe('mention.page');

      const event = JSON.parse(delivery.body) as {
        id: string;
        type: string;
        agent: { handle: string; name: string };
        page: { path: string; title: string };
        thread: unknown;
        text: string;
      };
      expect(event.id).toBe(delivery.headers['x-tablinum-delivery']);
      expect(event.agent).toMatchObject({ handle, name });
      expect(event.page).toMatchObject({ path: page_.path, title: 'The brief' });
      expect(event.thread).toBeNull();
      expect(event.text).toContain(`@${handle ?? ''}`);
      // The secret never travels with the delivery.
      expect(delivery.body).not.toContain(WEBHOOK_SECRET);

      await api.deletePage(page_.id);
      await page.goto('/settings/agents');
      await page.getByRole('button', { name: `Delete ${name}` }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.locator('.people-row').filter({ hasText: name })).toHaveCount(0);
    } finally {
      await hook.close();
    }
  });
});
