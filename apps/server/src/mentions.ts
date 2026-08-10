import type { FastifyBaseLogger } from 'fastify';
import type { AccountStore } from '@tablinum/accounts';
import { findMentions, type Page, type Writer } from '@tablinum/shared';
import type { SlackApi } from './slack.js';

/**
 * Mention notifications.
 *
 * Who to tell is worked out from the text itself: the handles in the saved markdown, minus
 * the handles that were already there. Nothing is stored, so a mention that is written,
 * removed and written again notifies twice, and no notification table can fall out of step
 * with the pages. A page is the record; this only carries the news.
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
}

export interface CommentPosted {
  /** The page the thread is about. The message points at it. */
  page: Page;
  body: string;
  /** The body before an edit. Null for a new comment, where every mention is new. */
  before: string | null;
  by: Writer | null;
}

export interface MentionNotifierOptions {
  accounts: AccountStore;
  /** Null when no bot token is configured, which turns delivery off. */
  slack: SlackApi | null;
  log: FastifyBaseLogger;
  /** Origin for the page link. Without it the message carries no link. */
  publicUrl?: string | null;
}

export function createMentionNotifier(options: MentionNotifierOptions): MentionNotifier {
  const { accounts, slack, log } = options;
  let queue: Promise<void> = Promise.resolve();

  /** Sends one message to everybody the handles name, skipping the writer and the unreachable. */
  async function tell(handles: string[], by: Writer | null, text: string): Promise<void> {
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

  /** Queues one delivery. A save must never fail because Slack is unreachable. */
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
        await tell(added, input.by, pageMessage(input, options.publicUrl ?? null));
      });
    },
    commentPosted(input: CommentPosted): void {
      later(input.page.path, async () => {
        const added = newMentions(input.body, input.before);
        await tell(added, input.by, commentMessage(input, options.publicUrl ?? null));
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
