import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { assetDirRelPath, type PageId } from '@tablinum/shared';
import type { ContentStore, GitEngine } from './deps.js';

/**
 * What a delete leaves behind.
 *
 * A page owns two things outside its own file: the attachments under `_assets/<pageId>/`, and,
 * when the page is private, the `.git/info/exclude` line that hides them. A space owns the
 * exclude line that hides the space itself. Deleting the page or the space used to leave all of
 * it in place: the bytes stayed in the repo with nothing pointing at them, and the exclude line
 * outlived its subject, so a later space that took the same slug was silently kept out of git.
 *
 * This runs after any delete, whichever way it arrived: the API route reports what it removed,
 * and the content watcher reports what disappeared on disk. Both name candidates only. Whether
 * each one is really gone is decided here, against the store, because a move looks exactly like
 * a delete followed by a create and must not cost the page its attachments.
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

  const attachments = new Map<PageId, string[]>();
  for (const id of await deadPages(parts.store, new Set(deleted.pageIds ?? []))) {
    const names = await readdir(join(parts.store.contentDir, assetDirRelPath(id))).catch(() => null);
    // Nothing left on disk to hide, so the line that hid it is stale whatever links to it.
    if (names === null) await parts.git.unexcludePath(assetDirRelPath(id));
    if (names !== null) attachments.set(id, names);
  }
  if (attachments.size === 0) return [];

  const shared = await stillReferenced(parts.store, [...attachments.keys()]);
  const removed: string[] = [];
  for (const [id, names] of attachments) {
    if (shared.has(id)) continue;
    removed.push(...(await removeAssets(parts, id, names)));
    await parts.git.unexcludePath(assetDirRelPath(id));
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

/**
 * Of the given dead ids, the ones a surviving page still points at.
 *
 * This matters because an attachment URL carries the id of the page it was uploaded to, not of
 * the page it is shown on: duplicating a page copies the markdown as it stands, so the copy
 * reads the original's attachments. Deleting the original must not blank the copy. Every page
 * is read, so this only runs for a delete that really had attachments.
 */
async function stillReferenced(store: ContentStore, gone: PageId[]): Promise<Set<PageId>> {
  const referenced = new Set<PageId>();
  for (const summary of await store.listPages()) {
    if (referenced.size === gone.length) break;
    const page = await store.getPageById(summary.id);
    if (page === null) continue;
    for (const id of gone) {
      if (page.markdown.includes(`/${assetDirRelPath(id)}/`)) referenced.add(id);
    }
  }
  return referenced;
}

/** Delete one page's attachment directory. Returns the files that were in it. */
async function removeAssets(parts: CleanupParts, id: PageId, names: string[]): Promise<string[]> {
  const relDir = assetDirRelPath(id);
  const files = names.map((name) => `${relDir}/${name}`);
  parts.markWritten?.(files);
  await rm(join(parts.store.contentDir, relDir), { recursive: true, force: true });
  return files;
}
