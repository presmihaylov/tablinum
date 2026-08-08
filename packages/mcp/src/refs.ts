import { isPageId, isValidPagePath, validation, type Page, type PageId, type PagePath } from '@gitdocs/shared';
import type { GitdocsClient } from './client.js';

/** Every page tool accepts either the stable id or the current path. */
export interface PageRef {
  id?: string | undefined;
  path?: string | undefined;
}

export type ResolvedRef = { kind: 'id'; id: PageId } | { kind: 'path'; path: PagePath };

const MISSING =
  'Provide either "id" (a stable page id like "pg_01J8XYZ...") or "path" (a page path like "eng/runbooks/deploy"). ' +
  'Neither was given. Call gitdocs_list_tree or gitdocs_search first to find the page.';

/** Validate an id-or-path pair and say exactly which one to use. */
export function normalizeRef(ref: PageRef): ResolvedRef {
  const id = ref.id?.trim() ?? '';
  const path = ref.path?.trim() ?? '';

  if (id.length > 0) {
    // Computed before the guard below, which narrows `id` away.
    const looksLikePath = id.includes('/') || isValidPagePath(id);
    if (isPageId(id)) return { kind: 'id', id };
    const detail = looksLikePath ? ' That looks like a page path: pass it as "path" instead.' : '';
    throw validation(
      `"id" must be a page id like "pg_01J8XYZ...", got ${JSON.stringify(id)}.${detail}`,
    );
  }

  if (path.length > 0) {
    if (isValidPagePath(path)) return { kind: 'path', path };
    throw validation(
      `"path" must be a page path like "eng/runbooks/deploy", got ${JSON.stringify(path)}. ` +
        'Use no leading or trailing slash, no ".md" suffix and no "index" segment.',
    );
  }

  throw validation(MISSING);
}

/** Fetch the full page named by an id-or-path reference. */
export async function resolvePage(client: GitdocsClient, ref: PageRef): Promise<Page> {
  const resolved = normalizeRef(ref);
  if (resolved.kind === 'id') return client.getPageById(resolved.id);
  return client.getPageByPath(resolved.path);
}

/**
 * Resolve a reference down to a page id, which is what the write endpoints take.
 * An id costs no extra request; a path costs one lookup.
 */
export async function resolvePageId(client: GitdocsClient, ref: PageRef): Promise<PageId> {
  const resolved = normalizeRef(ref);
  if (resolved.kind === 'id') return resolved.id;
  const page = await client.getPageByPath(resolved.path);
  return page.id;
}

/** Short human label for a reference, used in tool output before the page is fetched. */
export function refLabel(ref: PageRef): string {
  const resolved = normalizeRef(ref);
  return resolved.kind === 'id' ? resolved.id : resolved.path;
}
