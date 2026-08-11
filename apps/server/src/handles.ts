import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { findMentions, renameMentions, type Page } from '@tablinum/shared';
import type { RouteContext } from './context.js';
import type { ContentStore } from './deps.js';
import { guardPrivateSpaces, viewerOf } from './private.js';
import type { WorkspaceParts } from './workspaces.js';

/**
 * Handle renames.
 *
 * A mention is plain `@handle` text in a markdown file, so changing a handle in the account
 * database alone would leave every page naming somebody who no longer answers to that name.
 * These helpers sweep the content instead: they read each page through its own workspace store
 * and write the new text back through the same path a person's edit takes, so the index, the
 * open tabs and the commit all happen the way they always do.
 *
 * The count and the sweep read through deliberately different stores. See countMentions() and
 * rewriteMentions() below, which say why.
 */

/** How much text carries a handle. What the preview shows. */
export interface MentionCount {
  pages: number;
  comments: number;
}

/** What a rewrite changed. `skipped` counts pages it could not write, see rewriteWorkspace(). */
export interface MentionRewrite extends MentionCount {
  skipped: number;
}

/** Every page in `store` whose body carries `@handle` right now. */
async function pagesMentioning(
  store: ContentStore,
  handle: string,
  log: FastifyBaseLogger,
): Promise<Page[]> {
  const found: Page[] = [];
  for (const summary of await store.listPages()) {
    const page = await store.getPageById(summary.id).catch((err: unknown) => {
      // Skipping one unreadable page is right, doing it in silence is not: this sweep rewrites
      // other people's committed files, so an operator has to be able to see what it missed.
      log.warn({ page: summary.id, err }, 'page skipped while looking for a handle');
      return null;
    });
    if (page === null) continue;
    if (findMentions(page.markdown).includes(handle)) found.push(page);
  }
  return found;
}

/**
 * How many pages and comments name `@handle` today. What the preview shows.
 *
 * This one reads through the viewer's own store, unlike the sweep below. A preview is a request
 * a person made on their own behalf, and a private space somebody else owns must not raise the
 * number: that number alone would tell them a page they cannot open exists and names them.
 *
 * It also only reads workspaces that are already open. A preview is a GET, and opening a
 * workspace inits its repo and reindexes every page in it, which no read may cost.
 */
export async function countMentions(
  ctx: RouteContext,
  request: FastifyRequest,
  handle: string,
): Promise<MentionCount> {
  const viewer = viewerOf(request);
  let pages = 0;
  for (const parts of await ctx.workspaces.openParts()) {
    const seen = guardPrivateSpaces(parts.store, viewer);
    pages += (await pagesMentioning(seen, handle, ctx.log)).length;
  }
  return { pages, comments: ctx.deps.accounts.countCommentMentions(handle) };
}

/**
 * Rewrite `@from` as `@to` everywhere it is used.
 *
 * This one reads the raw store, unlike the count above, and every workspace including the ones
 * nobody has opened yet. Identity has to stay the same in every file: a page in a private space
 * the person cannot see still names them, and leaving it behind would let the old handle drift
 * onto somebody else. A rename is a mutation somebody asked for, so it can afford the opening.
 *
 * Each workspace gets one commit, so the change reads as a single deliberate act in the log
 * rather than as a burst of ordinary saves. Comments live in the account database and are
 * rewritten there.
 */
export async function rewriteMentions(
  ctx: RouteContext,
  from: string,
  to: string,
): Promise<MentionRewrite> {
  let pages = 0;
  let skipped = 0;
  for (const parts of await ctx.workspaces.everyParts()) {
    const done = await rewriteWorkspace(parts, from, to, ctx.log);
    pages += done.pages;
    skipped += done.skipped;
  }
  return { pages, skipped, comments: ctx.deps.accounts.renameCommentMentions(from, to) };
}

async function rewriteWorkspace(
  parts: WorkspaceParts,
  from: string,
  to: string,
  log: FastifyBaseLogger,
): Promise<{ pages: number; skipped: number }> {
  const targets = await pagesMentioning(parts.store, from, log);
  if (targets.length === 0) return { pages: 0, skipped: 0 };

  // Ordinary saves are debounced, so anything still pending would be swept into the commit
  // below by `git add -A` and then described by its message. Let it land under its own first.
  await parts.git.flushCommit().catch((err: unknown) => {
    log.warn({ workspace: parts.record.slug, err }, 'could not flush pending commits before a rename');
    return null;
  });

  const written: Page[] = [];
  let skipped = 0;
  for (const page of targets) {
    const markdown = renameMentions(page.markdown, from, to);
    if (markdown === page.markdown) continue;

    // `page.rev` is the rev of the text this sweep read. Every page is read before any page is
    // written, and on a big workspace that gap is long enough for somebody to type into one, so
    // without a base the save would throw their edit away and write the pre-rename snapshot.
    const saved = await parts.store
      .updatePage(page.id, { markdown, baseRev: page.rev })
      .catch((err: unknown) => {
        // One page that will not merge must not abort the rename and leave it half applied. The
        // page keeps the old handle, which the reservation still points at, and the caller is
        // told the number so a person can come back to it.
        log.warn({ page: page.id, path: page.path, err }, 'page kept its old handle');
        skipped += 1;
        return null;
      });
    if (saved !== null) written.push(saved);
  }
  if (written.length === 0) return { pages: 0, skipped };

  const message = `Rename @${from} to @${to} in ${written.length} ${written.length === 1 ? 'page' : 'pages'}`;
  // The commit is made here, not scheduled, so the whole rename is one revision.
  await parts.wiring.recordMutation({ pages: written, message, skipCommit: true });
  await parts.git.commit(message);
  return { pages: written.length, skipped };
}
