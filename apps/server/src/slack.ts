import type { FastifyBaseLogger } from 'fastify';

/**
 * The small part of the Slack Web API that gitdocs uses.
 *
 * Only two calls are needed: find a person by their email address, and send them a direct
 * message. gitdocs never reads Slack, so one bot token covers the whole workspace and no
 * per-person secret is stored.
 */
export interface SlackApi {
  /** The Slack member id for an email address, or null when Slack does not know it. */
  lookupByEmail(email: string): Promise<string | null>;
  /** Sends a direct message. False when Slack refused it. */
  postMessage(userId: string, text: string): Promise<boolean>;
}

export interface SlackApiOptions {
  token: string;
  log?: FastifyBaseLogger;
  /** Swapped in tests so nothing reaches the network. */
  fetch?: typeof globalThis.fetch;
}

const SLACK_API = 'https://slack.com/api';

/** Slack answers 200 with `{ok: false, error}` for most failures, so the body decides. */
interface SlackResponse {
  ok?: boolean;
  error?: string;
  user?: { id?: string };
}

export function createSlackApi(options: SlackApiOptions): SlackApi {
  const call = options.fetch ?? globalThis.fetch;
  const headers = {
    authorization: `Bearer ${options.token}`,
    'content-type': 'application/json; charset=utf-8',
  };

  async function post(method: string, body: Record<string, string>): Promise<SlackResponse> {
    const response = await call(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Slack ${method} answered ${response.status}`);
    return (await response.json()) as SlackResponse;
  }

  return {
    async lookupByEmail(email: string): Promise<string | null> {
      const result = await post('users.lookupByEmail', { email });
      if (result.ok !== true) {
        options.log?.debug({ error: result.error }, 'slack lookup failed');
        return null;
      }
      return result.user?.id ?? null;
    },

    async postMessage(userId: string, text: string): Promise<boolean> {
      const result = await post('chat.postMessage', { channel: userId, text });
      if (result.ok === true) return true;
      options.log?.warn({ error: result.error, userId }, 'slack message was refused');
      return false;
    },
  };
}
