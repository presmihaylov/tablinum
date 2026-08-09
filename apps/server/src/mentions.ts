import type { FastifyBaseLogger } from 'fastify';
import type { AccountStore } from '@tablinum/accounts';
import { findMentions, type Account, type Page } from '@tablinum/shared';
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
  /** Resolves once every queued notification is done. Tests use this. */
  idle(): Promise<void>;
}

export interface PageSaved {
  page: Page;
  /** The body before this save. Null for a new page, where every mention is new. */
  before: string | null;
  /** Who saved it, so nobody is told about their own mention. */
  by: Account | null;
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

  async function deliver(input: PageSaved): Promise<void> {
    if (slack === null) return;
    const added = newMentions(input.page.markdown, input.before);
    if (added.length === 0) return;

    for (const handle of added) {
      const target = accounts.getUserByHandle(handle);
      if (target === null || target.disabled) continue;
      if (input.by !== null && target.id === input.by.id) continue;

      const slackUserId = accounts.getSlackUserId(target.id);
      if (slackUserId === null) continue;
      await slack.postMessage(slackUserId, messageFor(input, options.publicUrl ?? null));
    }
  }

  return {
    pageSaved(input: PageSaved): void {
      queue = queue.then(async () => {
        try {
          await deliver(input);
        } catch (err) {
          // A save must never fail because Slack is unreachable.
          log.warn({ err, path: input.page.path }, 'failed to send a mention notification');
        }
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

function messageFor(input: PageSaved, publicUrl: string | null): string {
  const title = escape(input.page.title.length === 0 ? input.page.path : input.page.title);
  const who = input.by === null ? 'Somebody' : escape(input.by.name);
  const link = publicUrl === null ? input.page.path : pageUrl(publicUrl, input.page.path);
  return `*${who}* mentioned you in *${title}*\n${link}`;
}

function pageUrl(publicUrl: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${publicUrl}/p/${encoded}`;
}

/** The three characters Slack reads as markup in message text. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
