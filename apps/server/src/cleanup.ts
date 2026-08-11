import { join } from 'node:path';
import { readDirNames, type AssetRefSource } from '@tablinum/core';
import { ASSETS_DIR, assetDirRelPath, isPageId, type PageId } from '@tablinum/shared';
import type { ContentStore, GitEngine } from './deps.js';

/**
 * What a delete leaves behind: the attachments under `_assets/<pageId>/`, and the
 * `.git/info/exclude` line that hides a private page's attachments or a private space.
 *
 * The store owns the files, so it takes the attachments away; this decides which exclude lines
 * have outlived their subject. Callers name candidates only: a move is a delete and a create,
 * so whether the subject is really gone is settled here, against the store.
 *
 * Which references keep an attachment alive: any page file that names `/_assets/<id>/`,
 * frontmatter and body alike, and anything the caller's `assetRefs` source reports. A comment
 * renders markdown, so an `![x](/_assets/…)` typed into a comment on a surviving page is a
 * reference like any other; but comment bodies live in the account database, which the content
 * store cannot see. The source is injected rather than imported so that separation holds.
 *
 * A source that cannot answer keeps every candidate. A private space is excluded from git and
 * is never committed, so an attachment deleted there is gone for good, while one kept by
 * mistake only costs disk. A failed lookup must never read as "nothing points at this".
 *
 * deletePage() and deleteSpace() collect attachments inside the store, before anything here
 * runs, so the store is handed the same source at boot. Both layers therefore ask one function
 * and get one answer; asking twice costs a query and never a file.
 */

/** Subjects a delete may have removed. Each one is checked before anything is deleted. */
export interface DeletedSubjects {
  pageIds?: Iterable<PageId>;
  spaceSlugs?: Iterable<string>;
}

/** One contract for "what else points at this", shared with the store's own delete path. */
export type { AssetRefSource };

/** The one thing the comment-backed source reads. Narrowed so tests can stand in for it. */
export interface CommentBodyReader {
  commentBodiesContaining(needle: string): string[];
}

/**
 * Of these page ids, the ones a comment still shows an attachment of.
 *
 * A comment body is markdown in the account database, so `![x](/_assets/<id>/y.png)` renders as
 * a picture there and the file behind it is in use, even though no page file names it. A comment
 * body is the only markdown the account database holds; every other free-text column in it is
 * shown as plain text, so no url in one of those can render a file.
 *
 * A failed read is reported and then rethrown. The rethrow is what keeps the attachments: every
 * caller reads a throw as "cannot say", and an empty answer would read as "no references".
 */
export function commentAssetRefs(
  accounts: CommentBodyReader,
  onError?: (err: unknown) => void,
): AssetRefSource {
  return (candidates) => {
    try {
      const bodies = accounts.commentBodiesContaining(`/${ASSETS_DIR}/`);
      if (bodies.length === 0) return [];
      return candidates.filter((id) =>
        bodies.some((body) => body.includes(`/${assetDirRelPath(id)}/`)),
      );
    } catch (err: unknown) {
      onError?.(err);
      throw err;
    }
  };
}

export interface CleanupParts {
  /** The unfiltered store: a private space somebody else owns still owns its files. */
  store: ContentStore;
  git: GitEngine;
  /** Told the files about to go, so the watcher does not read them back as an outside change. */
  markWritten?: (files: string[]) => void;
  /** References the content tree cannot see. Left out, only page files keep an attachment. */
  assetRefs?: AssetRefSource;
}

/**
 * Remove the attachments and exclude lines a delete orphaned. Returns the content-relative
 * files it deleted.
 */
export async function cleanUpAfterDelete(
  parts: CleanupParts,
  deleted: DeletedSubjects,
): Promise<string[]> {
  for (const slug of new Set(deleted.spaceSlugs ?? [])) {
    if (await spaceExists(parts.store, slug)) continue;
    await parts.git.unexcludePath(slug);
  }

  const gone = await deadPages(parts.store, new Set(deleted.pageIds ?? []));
  if (gone.length === 0) return [];

  // Held outside the content tree, so the store would never see it and would delete the files.
  const held = await heldOutsideContent(parts, gone);
  const collectable = gone.filter((id) => !held.has(id));
  if (collectable.length === 0) return [];

  const { removed, kept } = await parts.store.removeOrphanedAssets(collectable);
  parts.markWritten?.(removed);
  const survives = new Set(kept);
  for (const id of collectable) {
    // Nothing left on disk to hide, so the line that hid it is stale whatever links to it.
    if (!survives.has(id)) await parts.git.unexcludePath(assetDirRelPath(id));
  }
  return removed;
}

/**
 * Of `candidates`, the ids something outside the content tree still points at.
 *
 * A source that throws holds every candidate. It has just said it cannot see its references,
 * and the alternative reading, that it has none, is the one that deletes files nobody can get
 * back out of a private space.
 */
async function heldOutsideContent(
  parts: CleanupParts,
  candidates: readonly PageId[],
): Promise<Set<PageId>> {
  const source = parts.assetRefs;
  if (source === undefined) return new Set();
  try {
    return new Set(await source(candidates));
  } catch {
    return new Set(candidates);
  }
}

/**
 * The same clean-up over every attachment directory there is, for the orphans nobody named.
 *
 * An install that ran the code before a page delete collected its attachments still carries
 * them, and no delete will ever name those ids again. Reading `_assets/` back is the only way
 * to find them. Every candidate goes through the checks above unchanged, so a directory whose
 * page still exists, or whose files a page still points at, is kept.
 *
 * The caller must have rebuilt the store index first. `deadPages()` asks the index whether a
 * page is gone, and an index that predates the working tree would call a live page dead.
 */
export async function sweepOrphanedAssets(parts: CleanupParts): Promise<string[]> {
  const names = await readDirNames(join(parts.store.contentDir, ASSETS_DIR));
  // Only directories named after a page id: anything else was not put there by an upload, so
  // nothing here can say whether it is orphaned.
  return cleanUpAfterDelete(parts, { pageIds: names.filter(isPageId) });
}

async function spaceExists(store: ContentStore, slug: string): Promise<boolean> {
  const spaces = await store.listSpaces();
  return spaces.some((space) => space.slug === slug);
}

/** The candidates no page answers to any more. A move re-creates the page, so it is not one. */
async function deadPages(store: ContentStore, candidates: Set<PageId>): Promise<PageId[]> {
  const gone: PageId[] = [];
  for (const id of candidates) {
    if ((await store.getPageById(id)) === null) gone.push(id);
  }
  return gone;
}
