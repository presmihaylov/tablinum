import { z } from 'zod';

/**
 * Slack delivery for mentions.
 *
 * The server holds one bot token for the whole workspace, and each person stores their own
 * Slack member id. tablinum sends a direct message; it never reads Slack, so no user token,
 * no OAuth dance and no per-user secret is stored.
 */

/** Slack member ids look like `U01AB2CD3EF`. `W` is used by Enterprise Grid. */
const SLACK_USER_ID_RE = /^[UW][A-Z0-9]{2,30}$/;

export const isSlackUserId = (value: unknown): value is string =>
  typeof value === 'string' && SLACK_USER_ID_RE.test(value);

export const SlackUserIdSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(isSlackUserId, 'Expected a Slack member id like "U01AB2CD3EF"');

/** With no id the server looks the person up by their tablinum email address. */
export const ConnectSlackBodySchema = z.object({ slackUserId: SlackUserIdSchema.optional() });

export const SlackStateResponseSchema = z.object({
  /** True when the server has a bot token, so connecting is possible at all. */
  configured: z.boolean(),
  connected: z.boolean(),
  slackUserId: z.string().nullable(),
});

export type ConnectSlackBody = z.infer<typeof ConnectSlackBodySchema>;
export type SlackStateResponse = z.infer<typeof SlackStateResponseSchema>;
