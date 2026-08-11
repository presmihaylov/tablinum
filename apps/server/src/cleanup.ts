import { assetDirRelPath, type PageId } from '@tablinum/shared';
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
 * frontmatter and body alike. Comment bodies are NOT scanned. They live in the account database,
 * which the content store cannot see, and a comment renders markdown, so an `![x](/_assets/…)`
 * typed into a comment on a surviving page does not save the file. Nothing in the UI uploads an
 * attachment from a comment, so such a url can only get there by hand.
 */

/** Subjects a delete may have removed. Each one is checked before anything is deleted. */
export interface DeletedSubjects {
  pageIds?: Iterable<PageId>;
  spaceSlugs?: Iterable<string>;
}

export interface CleanupParts {
  /** The unfiltered store: a private space somebody else owns still owns its files. */
  store: ContentStore;
  git: GitEngine;
  /** Told the files about to go, so the watcher does not read them back as an outside change. */
  markWritten?: (files: string[]) => void;
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

  const { removed, kept } = await parts.store.removeOrphanedAssets(gone);
  parts.markWritten?.(removed);
  const survives = new Set(kept);
  for (const id of gone) {
    // Nothing left on disk to hide, so the line that hid it is stale whatever links to it.
    if (!survives.has(id)) await parts.git.unexcludePath(assetDirRelPath(id));
  }
  return removed;
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
