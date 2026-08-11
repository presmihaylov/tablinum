import { validation } from './errors.js';
import type { PageId, PagePath } from './types.js';

/** Extension of every page file. */
export const PAGE_EXT = '.md';
/** Basename of the file that represents a page which has children. */
export const INDEX_BASENAME = 'index';
/** File that describes a space, one per top-level directory. */
export const SPACE_FILE = '_space.yml';
/** Directory that holds uploaded attachments, relative to the content root. */
export const ASSETS_DIR = '_assets';
/**
 * Prefix of the file a save writes before it moves it over the real one. A leading dot keeps it
 * away from the scanner and the watcher, and git-sync excludes the pattern, so a commit that
 * fires mid-save can never pick one up.
 */
export const TEMP_FILE_PREFIX = '.tablinum-tmp-';
/** The `.git/info/exclude` line that hides every one of them. */
export const TEMP_FILE_EXCLUDE_LINE = `${TEMP_FILE_PREFIX}*`;

const MAX_SEGMENT_LENGTH = 120;
/** Characters that break on some filesystem, in URLs, or in git. */
const UNSAFE_SEGMENT_RE = /[\u0000-\u001f\u007f\\:*?"<>|]/;

/** Split a page path into its segments. Returns [] for an empty path. */
export function segments(path: string): string[] {
  if (path.length === 0) return [];
  return path.split('/');
}

function isValidSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  if (segment.length > MAX_SEGMENT_LENGTH) return false;
  if (segment === '.' || segment === '..') return false;
  if (UNSAFE_SEGMENT_RE.test(segment)) return false;
  if (segment.trim() !== segment) return false;
  if (segment.startsWith('_')) return false; // reserved: _assets, _space.yml
  // The scanner skips dot-names (.git, .tablinum), so such a page would be written but never
  // indexed: invisible to the API and impossible to delete through it.
  if (segment.startsWith('.')) return false;
  if (segment.endsWith('.')) return false;
  if (segment.toLowerCase().endsWith(PAGE_EXT)) return false; // paths never carry the extension
  return true;
}

/**
 * A page path is a relative, slash-joined, traversal-free path with no extension.
 * "eng/runbooks/deploy" is valid; "/eng", "eng/", "eng//x", "../etc" and "eng/index" are not.
 */
export function isValidPagePath(path: unknown): path is PagePath {
  if (typeof path !== 'string') return false;
  if (path.length === 0) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  const parts = segments(path);
  if (parts.length === 0) return false;
  if (!parts.every(isValidSegment)) return false;
  // "eng/index" would collide with the index.md of "eng".
  if (parts[parts.length - 1] === INDEX_BASENAME) return false;
  return true;
}

/** Return the path, or throw a VALIDATION AppError describing why it is rejected. */
export function assertValidPagePath(path: unknown, label = 'path'): PagePath {
  if (isValidPagePath(path)) return path;
  throw validation(`Invalid ${label}: ${JSON.stringify(path)}`);
}

/**
 * Map a page path to its file, relative to the content root.
 * "eng/deploy" -> "eng/deploy.md"; "eng" with children -> "eng/index.md".
 */
export function pagePathToRelFile(path: PagePath, hasChildren: boolean): string {
  const valid = assertValidPagePath(path);
  if (hasChildren) return `${valid}/${INDEX_BASENAME}${PAGE_EXT}`;
  return `${valid}${PAGE_EXT}`;
}

/**
 * Map a content-root-relative file back to its page path.
 * "eng/runbooks/index.md" -> "eng/runbooks"; "eng/deploy.md" -> "eng/deploy".
 */
export function relFileToPagePath(rel: string): PagePath {
  const normalized = rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!normalized.toLowerCase().endsWith(PAGE_EXT)) {
    throw validation(`Not a page file: ${JSON.stringify(rel)}`);
  }
  const withoutExt = normalized.slice(0, -PAGE_EXT.length);
  const parts = segments(withoutExt);
  if (parts[parts.length - 1] === INDEX_BASENAME) parts.pop();
  return assertValidPagePath(parts.join('/'), 'file path');
}

/** True when the file is a page that has children (an index.md). */
export function isIndexFile(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/');
  return normalized.toLowerCase().endsWith(`/${INDEX_BASENAME}${PAGE_EXT}`);
}

/** Parent page path, or null when the path is a space root. */
export function parentPath(path: PagePath): PagePath | null {
  const parts = segments(assertValidPagePath(path));
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join('/');
}

/** First segment of a page path: the space slug. */
export function spaceOf(path: PagePath): string {
  return segments(assertValidPagePath(path))[0]!;
}

/** Last segment of a page path: the slug of the page itself. */
export function baseName(path: PagePath): string {
  const parts = segments(assertValidPagePath(path));
  return parts[parts.length - 1]!;
}

/** Number of segments. A space root has depth 1. */
export function depth(path: PagePath): number {
  return segments(assertValidPagePath(path)).length;
}

/** Join path fragments, ignoring empty ones, and validate the result. */
export function joinPath(a: string, b: string, ...rest: string[]): PagePath {
  const parts = [a, b, ...rest]
    .flatMap((part) => segments(part.replace(/^\/+|\/+$/g, '')))
    .filter((part) => part.length > 0);
  return assertValidPagePath(parts.join('/'), 'joined path');
}

/** True when `child` sits anywhere below `ancestor`. A path is not its own ancestor. */
export function isDescendantOf(child: PagePath, ancestor: PagePath): boolean {
  if (child === ancestor) return false;
  return child.startsWith(`${ancestor}/`);
}

/** Rewrite `path` so that the `from` prefix becomes `to`. Used when a subtree moves. */
export function replacePathPrefix(path: PagePath, from: PagePath, to: PagePath): PagePath {
  if (path === from) return assertValidPagePath(to, 'target path');
  if (!isDescendantOf(path, from)) {
    throw validation(`${JSON.stringify(path)} is not inside ${JSON.stringify(from)}`);
  }
  return assertValidPagePath(`${to}${path.slice(from.length)}`, 'target path');
}

/** Content-root-relative path of a space descriptor file. */
export function spaceFileRelPath(slug: string): string {
  const valid = assertValidPagePath(slug, 'space slug');
  if (segments(valid).length !== 1) throw validation(`Space slug must be one segment: ${slug}`);
  return `${valid}/${SPACE_FILE}`;
}

/** Content-root-relative directory that holds every attachment of one page. */
export function assetDirRelPath(pageId: PageId): string {
  return `${ASSETS_DIR}/${pageId}`;
}

/** Content-root-relative path of an attachment. */
export function assetRelPath(pageId: PageId, filename: string): string {
  const safe = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  if (safe.length === 0 || safe === '.' || safe === '..' || UNSAFE_SEGMENT_RE.test(safe)) {
    throw validation(`Invalid attachment filename: ${JSON.stringify(filename)}`);
  }
  return `${ASSETS_DIR}/${pageId}/${safe}`;
}

/** Public URL of an attachment, as embedded in markdown. */
export function assetUrl(pageId: PageId, filename: string): string {
  return `/${assetRelPath(pageId, filename)}`;
}

/**
 * Suffix of a diagram attachment. The file is an SVG with the drawing's own scene embedded
 * in it, so one attachment is both the picture every markdown reader shows and the scene
 * the editor reopens. Two extensions, so `extname` alone never splits it correctly.
 */
export const DIAGRAM_EXT = '.excalidraw.svg';

/** True when an attachment name or URL names a diagram rather than a plain image. */
export function isDiagramPath(path: string): boolean {
  return path.length > DIAGRAM_EXT.length && path.toLowerCase().endsWith(DIAGRAM_EXT);
}

const ASSET_URL_RE = new RegExp(`^/${ASSETS_DIR}/([^/?#]+)/([^/?#]+)$`);

/** Split an attachment URL back into the page that holds it and its filename. */
export function parseAssetUrl(url: string): { pageId: PageId; filename: string } | null {
  const match = ASSET_URL_RE.exec(url);
  if (match === null) return null;
  return { pageId: match[1] ?? '', filename: match[2] ?? '' };
}
