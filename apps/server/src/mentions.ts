import type { FastifyBaseLogger } from 'fastify';
import type { AccountStore } from '@tablinum/accounts';
import {
  findMentions,
  newDeliveryId,
  type Agent,
  type Page,
  type WebhookEvent,
  type WebhookEventType,
  type Writer,
} from '@tablinum/shared';
import type { SlackApi } from './slack.js';
import type { WebhookSender } from './webhooks.js';

/**
 * Mention notifications.
 *
 * Who to tell is worked out from the text itself: the handles in the saved markdown, minus
 * the handles that were already there. Nothing is stored, so a mention that is written,
 * removed and written again notifies twice, and no notification table can fall out of step
 * with the pages. A page is the record; this only carries the news.
 *
 * A person is told in Slack. An agent has no inbox, so it is told by a signed webhook at the
 * address its admin set. Both go out after the write, so a mention that cannot be delivered
 * never costs anybody their edit.
 */
export interface MentionNotifier {
  /** Tells whoever is newly mentioned. Returns at once and never throws. */
  pageSaved(input: PageSaved): void;
  /** The same for a comment on a page. */
  commentPosted(input: CommentPosted): void;
  /** Resolves once every queued notification is done. Tests use this. */
  idle(): Promise<void>;
}

export interface PageSaved {
  page: Page;
  /** The body before this save. Null for a new page, where every mention is new. */
  before: string | null;
  /** Who saved it, so nobody is told about their own mention. */
  by: Writer | null;
  /** The workspace the page is in. An agent elsewhere is never told. */
  workspaceId: string;
}

export interface CommentPosted {
  /** The page the thread is about. The message points at it. */
  page: Page;
  body: string;
  /** The body before an edit. Null for a new comment, where every mention is new. */
  before: string | null;
  by: Writer | null;
  workspaceId: string;
  /** The thread the remark stands in, so a receiver can reply to the right one. */
  threadId: string;
}

export interface MentionNotifierOptions {
  accounts: AccountStore;
  /** Null when no bot token is configured, which turns delivery off. */
  slack: SlackApi | null;
  /** Null when no signing secret is configured. Nothing is ever delivered unsigned. */
  webhooks: WebhookSender | null;
  log: FastifyBaseLogger;
  /** Origin for the page link. Without it the message carries no link. */
  publicUrl?: string | null;
}

export function createMentionNotifier(options: MentionNotifierOptions): MentionNotifier {
  const { accounts, slack, webhooks, log } = options;
  const publicUrl = options.publicUrl ?? null;
  let queue: Promise<void> = Promise.resolve();

  /** Sends one message to everybody the handles name, skipping the writer and the unreachable. */
  async function tellPeople(handles: string[], by: Writer | null, text: string): Promise<void> {
    if (slack === null || handles.length === 0) return;
    for (const handle of handles) {
      const target = accounts.getUserByHandle(handle);
      if (target === null || target.disabled) continue;
      if (by !== null && target.id === by.id) continue;

      const slackUserId = accounts.getSlackUserId(target.id);
      if (slackUserId === null) continue;
      await slack.postMessage(slackUserId, text);
    }
  }

  /** The agents the handles name that are reachable from this workspace by a webhook. */
  function reachable(handles: string[], workspaceId: string, by: Writer | null): Agent[] {
    const found: Agent[] = [];
    for (const handle of handles) {
      const agent = accounts.getAgentByHandle(handle);
      if (agent === null || agent.webhookUrl === null) continue;
      // A handle is unique across the whole server, so one in another workspace is not ours.
      if (agent.workspaceId !== workspaceId) continue;
      if (by !== null && agent.id === by.id) continue;
      found.push(agent);
    }
    return found;
  }

  /** Posts one event per tagged agent. A receiver that is down loses the news, not the page. */
  async function tellAgents(
    handles: string[],
    type: WebhookEventType,
    context: { page: Page; workspaceId: string; by: Writer | null; threadId: string | null; text: string },
  ): Promise<void> {
    if (webhooks === null || handles.length === 0) return;
    const agents = reachable(handles, context.workspaceId, context.by);
    if (agents.length === 0) return;

    const workspace = accounts.getWorkspace(context.workspaceId);
    if (workspace === null) return;

    for (const agent of agents) {
      const url = agent.webhookUrl;
      if (url === null) continue;
      const event: WebhookEvent = {
        id: newDeliveryId(),
        type,
        created: new Date().toISOString(),
        agent: { id: agent.id, name: agent.name, handle: agent.handle },
        workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
        page: {
          id: context.page.id,
          path: context.page.path,
          title: context.page.title,
          url: publicUrl === null ? null : pageUrl(publicUrl, context.page.path),
        },
        by: writerOf(accounts, context.by),
        thread: context.threadId === null ? null : { id: context.threadId },
        text: context.text,
      };
      await webhooks.post(url, event);
    }
  }

  /** Queues one delivery. A save must never fail because a receiver is unreachable. */
  function later(path: string, run: () => Promise<void>): void {
    queue = queue.then(async () => {
      try {
        await run();
      } catch (err) {
        log.warn({ err, path }, 'failed to send a mention notification');
      }
    });
  }

  return {
    pageSaved(input: PageSaved): void {
      later(input.page.path, async () => {
        const added = newMentions(input.page.markdown, input.before);
        await tellPeople(added, input.by, pageMessage(input, publicUrl));
        await tellAgents(added, 'mention.page', {
          page: input.page,
          workspaceId: input.workspaceId,
          by: input.by,
          threadId: null,
          text: input.page.markdown,
        });
      });
    },
    commentPosted(input: CommentPosted): void {
      later(input.page.path, async () => {
        const added = newMentions(input.body, input.before);
        await tellPeople(added, input.by, commentMessage(input, publicUrl));
        await tellAgents(added, 'mention.comment', {
          page: input.page,
          workspaceId: input.workspaceId,
          by: input.by,
          threadId: input.threadId,
          text: input.body,
        });
      });
    },
    idle(): Promise<void> {
      return queue;
    },
  };
}

/** Handles in the new body that the old body did not already carry. */
export function newMentions(markdown: string, before: string | null): string[] {
  const had = new Set(before === null ? [] : findMentions(before));
  return findMentions(markdown).filter((handle) => !had.has(handle));
}

/** The writer as an event carries them. An operator token names nobody, so it stays null. */
function writerOf(
  accounts: AccountStore,
  by: Writer | null,
): { id: string; name: string; handle: string | null } | null {
  if (by === null) return null;
  const handle = accounts.getUser(by.id)?.handle ?? accounts.getAgent(by.id)?.handle ?? null;
  return { id: by.id, name: by.name, handle };
}

function pageMessage(input: PageSaved, publicUrl: string | null): string {
  return `*${who(input.by)}* mentioned you in *${titleOf(input.page)}*\n${linkOf(input.page, publicUrl)}`;
}

function commentMessage(input: CommentPosted, publicUrl: string | null): string {
  const head = `*${who(input.by)}* mentioned you in a comment on *${titleOf(input.page)}*`;
  return `${head}\n${linkOf(input.page, publicUrl)}`;
}

function who(by: Writer | null): string {
  return by === null ? 'Somebody' : escape(by.name);
}

function titleOf(page: Page): string {
  return escape(page.title.length === 0 ? page.path : page.title);
}

function linkOf(page: Page, publicUrl: string | null): string {
  return publicUrl === null ? page.path : pageUrl(publicUrl, page.path);
}

function pageUrl(publicUrl: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${publicUrl}/p/${encoded}`;
}

/** The three characters Slack reads as markup in message text. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
