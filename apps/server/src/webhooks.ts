import type { FastifyBaseLogger } from 'fastify';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  signWebhook,
  type WebhookEvent,
} from '@tablinum/shared';

/**
 * Webhook delivery.
 *
 * One POST per tagged agent, signed with the configured secret. A delivery never blocks the
 * write that caused it and never throws: a receiver that is down loses the news, not the page.
 */

/** How long one delivery may take before it is given up on. */
const TIMEOUT_MS = 10000;

export interface WebhookSender {
  /** Posts one signed event. Returns false when it did not arrive. Never throws. */
  post(url: string, event: WebhookEvent): Promise<boolean>;
}

export interface WebhookSenderOptions {
  /** Signs every delivery. Nothing is ever sent unsigned. */
  secret: string;
  log: FastifyBaseLogger;
  /** Injected by the tests, so no test reaches the network. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createWebhookSender(options: WebhookSenderOptions): WebhookSender {
  const send = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;

  return {
    async post(url: string, event: WebhookEvent): Promise<boolean> {
      // Serialized once: the signature covers exactly the bytes that go on the wire.
      const body = JSON.stringify(event);
      const timestamp = Math.floor(now() / 1000);
      const signature = await signWebhook(options.secret, timestamp, body);

      try {
        const response = await send(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [WEBHOOK_SIGNATURE_HEADER]: signature,
            [WEBHOOK_EVENT_HEADER]: event.type,
            [WEBHOOK_DELIVERY_HEADER]: event.id,
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.ok) return true;
        options.log.warn({ url, status: response.status }, 'an agent webhook was refused');
        return false;
      } catch (err) {
        options.log.warn({ err, url }, 'an agent webhook could not be delivered');
        return false;
      }
    },
  };
}
