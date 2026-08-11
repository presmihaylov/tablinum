import { z } from 'zod';
import { newUlid } from './ids.js';
import { IsoDateSchema } from './schemas.js';
import { WorkspaceIdSchema } from './workspaces.js';

/**
 * Webhooks.
 *
 * An agent that is tagged is told over HTTP, because an agent has no inbox to read. The event
 * carries where it was tagged and what was written there, so the receiver can act without
 * calling back for context. Every delivery is signed, so the receiver can tell an event from
 * tablinum apart from anything else that finds the URL.
 */

/** `t=<unix seconds>,v1=<hex>`. See signWebhook(). */
export const WEBHOOK_SIGNATURE_HEADER = 'x-tablinum-signature';
/** The event type, so a receiver can route without parsing the body. */
export const WEBHOOK_EVENT_HEADER = 'x-tablinum-event';
/** Unique per delivery. A receiver stores it to make a repeated delivery harmless. */
export const WEBHOOK_DELIVERY_HEADER = 'x-tablinum-delivery';

/** How old a signature may be. It stops a recorded delivery from being replayed later. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Prefix of a delivery id, in the style of the page and agent ids. */
export const WEBHOOK_DELIVERY_PREFIX = 'whd_';

export const newDeliveryId = (now?: number): string => WEBHOOK_DELIVERY_PREFIX + newUlid(now);

/** Longest webhook URL the server stores. */
export const MAX_WEBHOOK_URL_LENGTH = 2000;

/**
 * Where an agent is told. Only http and https, because nothing else is a delivery, and a
 * relative URL would name this server.
 */
export const WebhookUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_WEBHOOK_URL_LENGTH)
  .refine((value) => /^https?:\/\/\S+$/.test(value), 'Expected a http:// or https:// URL');

export const WebhookEventTypeSchema = z.enum(['mention.page', 'mention.comment']);

const WriterSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Null when the writer is an operator token rather than an account. */
  handle: z.string().nullable(),
});

export const WebhookEventSchema = z.object({
  /** Unique per delivery, and repeated when the same event is delivered again. */
  id: z.string().min(1),
  type: WebhookEventTypeSchema,
  created: IsoDateSchema,
  /** The agent that was tagged. Its own id, so one receiver may serve several agents. */
  agent: z.object({ id: z.string(), name: z.string(), handle: z.string() }),
  workspace: z.object({ id: WorkspaceIdSchema, slug: z.string(), name: z.string() }),
  page: z.object({
    id: z.string(),
    path: z.string(),
    title: z.string(),
    /** Where a person would open it, or null when the server has no public URL. */
    url: z.string().nullable(),
  }),
  /** Who wrote the mention, or null when it arrived without a writer. */
  by: WriterSchema.nullable(),
  /** The comment the mention stands in, or null when it stands in the page itself. */
  thread: z.object({ id: z.string() }).nullable(),
  /** What was written: the whole page body, or the comment. */
  text: z.string(),
});

/** What `GET /api/v1/webhooks/signing` answers. It carries no secret. */
export const WebhookSigningResponseSchema = z.object({
  /** False while no signing secret is configured, which turns delivery off. */
  enabled: z.boolean(),
  algorithm: z.literal('hmac-sha256'),
  /** Names the secret without revealing it, so a receiver can tell it holds the right one. */
  keyId: z.string().nullable(),
  signatureHeader: z.string(),
  eventHeader: z.string(),
  deliveryHeader: z.string(),
  toleranceSeconds: z.number(),
});

export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type WebhookSigningResponse = z.infer<typeof WebhookSigningResponseSchema>;

// ---------------------------------------------------------------------------
// signing
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

async function hmac(secret: string, text: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(text));
  return hex(new Uint8Array(signed));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The bytes that are signed. The timestamp is part of them, so a recorded delivery cannot be
 * replayed later under its own signature.
 */
export function signedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/** The value of the signature header for one delivery. `timestamp` is in whole seconds. */
export async function signWebhook(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  return `t=${timestamp},v1=${await hmac(secret, signedPayload(timestamp, body))}`;
}

/**
 * True when `header` is a signature this secret produced over this body, and is recent.
 * A receiver runs exactly this. `now` and `tolerance` are in whole seconds.
 */
export async function verifyWebhook(
  secret: string,
  header: string,
  body: string,
  now: number = Math.floor(Date.now() / 1000),
  tolerance: number = WEBHOOK_TOLERANCE_SECONDS,
): Promise<boolean> {
  const parts = parseSignature(header);
  if (parts === null) return false;
  if (Math.abs(now - parts.timestamp) > tolerance) return false;
  const wanted = await hmac(secret, signedPayload(parts.timestamp, body));
  return sameSecret(wanted, parts.signature);
}

function parseSignature(header: string): { timestamp: number; signature: string } | null {
  const fields = new Map<string, string>();
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    fields.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  const timestamp = Number(fields.get('t'));
  const signature = fields.get('v1');
  if (!Number.isInteger(timestamp) || signature === undefined) return null;
  return { timestamp, signature };
}

/** Compares in constant time, so a wrong signature never leaks how nearly right it was. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differs = 0;
  for (let at = 0; at < a.length; at += 1) {
    differs |= a.charCodeAt(at) ^ b.charCodeAt(at);
  }
  return differs === 0;
}

/**
 * A short name for a signing secret. It is a hash, so publishing it reveals nothing, and two
 * servers that hold the same secret report the same id.
 */
export async function webhookKeyId(secret: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`tablinum-webhook-key-id:${secret}`),
  );
  return hex(new Uint8Array(digest)).slice(0, 16);
}
