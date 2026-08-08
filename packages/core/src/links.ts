import {
  PAGE_EXT,
  INDEX_BASENAME,
  depth,
  parentPath,
  segments,
  type Backlink,
  type PageId,
  type PagePath,
} from '@gitdocs/shared';

export type LinkKind = 'wikilink' | 'markdown';

/** One internal link found in a markdown body. External and asset links are not reported. */
export interface ExtractedLink {
  kind: LinkKind;
  /** Target exactly as the author wrote it. */
  target: string;
  /** Display text: the part after `|` in a wikilink, or the text of a markdown link. */
  alias?: string;
  /** Offset of the whole link in the source. */
  index: number;
  /** Length of the whole link in the source. */
  length: number;
  raw: string;
}

const WIKILINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g;
const MARKDOWN_LINK =
  /(!?)\[((?:[^\]\\\n]|\\.)*)\]\(\s*(<[^>\n]*>|[^\s()]*)\s*(?:"[^"\n]*"|'[^'\n]*')?\s*\)/g;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const QUOTE_PREFIX = /^(?: {0,3}> ?)+/;

// ---------------------------------------------------------------------------
// code masking
// ---------------------------------------------------------------------------

function blank(line: string): string {
  return ' '.repeat(line.length);
}

/** Blank out an inline code span, keeping every offset in place. */
function maskInlineCode(line: string): string {
  const chars = line.split('');
  let index = 0;
  while (index < chars.length) {
    if (chars[index] !== '`') {
      index += 1;
      continue;
    }
    const openStart = index;
    while (index < chars.length && chars[index] === '`') index += 1;
    const runLength = index - openStart;
    let cursor = index;
    let closeStart = -1;
    while (cursor < chars.length) {
      if (chars[cursor] !== '`') {
        cursor += 1;
        continue;
      }
      const start = cursor;
      while (cursor < chars.length && chars[cursor] === '`') cursor += 1;
      if (cursor - start === runLength) {
        closeStart = start;
        break;
      }
    }
    if (closeStart === -1) break;
    for (let position = openStart; position < closeStart + runLength; position += 1) {
      chars[position] = ' ';
    }
    index = closeStart + runLength;
  }
  return chars.join('');
}

/**
 * A copy of the markdown with every code region replaced by spaces. Offsets and length are
 * unchanged, so a match found here points at the same place in the original.
 */
export function maskCodeRegions(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fenceChar: string | null = null;
  let fenceLength = 0;
  let fenceQuoted = false;
  for (const line of lines) {
    // The fence rules apply to the line inside the quote, not to the `> ` that carries it.
    const prefix = QUOTE_PREFIX.exec(line)?.[0] ?? '';
    const quoted = prefix.length > 0;
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.slice(prefix.length));
    const marker = match?.[1] ?? '';
    if (fenceChar === null) {
      if (match) {
        fenceChar = marker.charAt(0);
        fenceLength = marker.length;
        fenceQuoted = quoted;
        out.push(blank(line));
        continue;
      }
      out.push(maskInlineCode(line));
      continue;
    }
    // A fence opened inside a blockquote ends where the quote ends, even without a closer.
    if (fenceQuoted && !quoted) {
      fenceChar = null;
      fenceLength = 0;
      out.push(maskInlineCode(line));
      continue;
    }
    const closes =
      quoted === fenceQuoted &&
      match !== null &&
      marker.charAt(0) === fenceChar &&
      marker.length >= fenceLength &&
      (match[2] ?? '').trim().length === 0;
    if (closes) {
      fenceChar = null;
      fenceLength = 0;
    }
    out.push(blank(line));
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

function stripAngles(target: string): string {
  if (target.startsWith('<') && target.endsWith('>')) return target.slice(1, -1);
  return target;
}

/** True for anything that does not point at another page in this content repo. */
export function isExternalTarget(target: string): boolean {
  const trimmed = target.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('//')) return true;
  if (SCHEME.test(trimmed)) return true;
  const first = segments(trimmed.replace(/^\/+/, ''))[0] ?? '';
  return first.startsWith('_');
}

/** Every wikilink and relative markdown link in a body, in source order. */
export function extractLinks(markdown: string): ExtractedLink[] {
  const masked = maskCodeRegions(markdown);
  const links: ExtractedLink[] = [];

  WIKILINK.lastIndex = 0;
  for (let match = WIKILINK.exec(masked); match !== null; match = WIKILINK.exec(masked)) {
    const target = (match[1] ?? '').trim();
    if (target.length === 0) continue;
    const alias = match[2];
    const link: ExtractedLink = {
      kind: 'wikilink',
      target,
      index: match.index,
      length: match[0].length,
      raw: markdown.slice(match.index, match.index + match[0].length),
    };
    if (alias !== undefined) link.alias = alias.trim();
    links.push(link);
  }

  MARKDOWN_LINK.lastIndex = 0;
  for (let match = MARKDOWN_LINK.exec(masked); match !== null; match = MARKDOWN_LINK.exec(masked)) {
    if ((match[1] ?? '').length > 0) continue; // an image is an asset, not a page link
    const target = stripAngles((match[3] ?? '').trim());
    if (isExternalTarget(target)) continue;
    links.push({
      kind: 'markdown',
      target,
      alias: (match[2] ?? '').trim(),
      index: match.index,
      length: match[0].length,
      raw: markdown.slice(match.index, match.index + match[0].length),
    });
  }

  return links.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

/** The minimum a page must expose to take part in link resolution. */
export interface LinkablePage {
  id: PageId;
  path: PagePath;
  title: string;
  hasChildren?: boolean;
}

export interface ResolveOptions {
  /** Page the link was written on, used to resolve a relative target. */
  from?: PagePath;
}

export interface PageResolver {
  resolve(target: string, options?: ResolveOptions): LinkablePage | null;
  byPath(pagePath: PagePath): LinkablePage | null;
}

/** Directory a relative link on this page is resolved against. */
function linkBase(page: LinkablePage): PagePath | null {
  if (page.hasChildren === true) return page.path;
  if (depth(page.path) === 1) return page.path; // a space home page owns its directory
  return parentPath(page.path);
}

function normalizeTarget(target: string): string {
  let value = target.trim().replace(/\\/g, '/');
  const hash = value.indexOf('#');
  if (hash >= 0) value = value.slice(0, hash);
  const query = value.indexOf('?');
  if (query >= 0) value = value.slice(0, query);
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw text when it is not valid percent-encoding.
  }
  if (value.toLowerCase().endsWith(PAGE_EXT)) value = value.slice(0, -PAGE_EXT.length);
  return value.trim();
}

function joinRelative(target: string, base: PagePath | null): string | null {
  const absolute = target.startsWith('/');
  const parts = absolute || base === null ? [] : [...segments(base)];
  for (const segment of target.replace(/^\/+/, '').split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length > 0 && parts[parts.length - 1] === INDEX_BASENAME) parts.pop();
  if (parts.length === 0) return null;
  return parts.join('/');
}

/**
 * Resolve link targets against a set of pages: exact path first, then relative to the source
 * page, then a unique file name, then a unique title.
 */
export function createPageResolver(pages: Iterable<LinkablePage>): PageResolver {
  const byPath = new Map<PagePath, LinkablePage>();
  const byBase = new Map<string, LinkablePage[]>();
  const byTitle = new Map<string, LinkablePage[]>();

  for (const page of pages) {
    byPath.set(page.path, page);
    const parts = segments(page.path);
    const base = (parts[parts.length - 1] ?? '').toLowerCase();
    const bucket = byBase.get(base);
    if (bucket === undefined) byBase.set(base, [page]);
    else bucket.push(page);
    const title = page.title.trim().toLowerCase();
    const titleBucket = byTitle.get(title);
    if (titleBucket === undefined) byTitle.set(title, [page]);
    else titleBucket.push(page);
  }

  const unique = (bucket: LinkablePage[] | undefined): LinkablePage | null => {
    if (bucket === undefined || bucket.length !== 1) return null;
    return bucket[0] ?? null;
  };

  const resolve = (target: string, options: ResolveOptions = {}): LinkablePage | null => {
    const normalized = normalizeTarget(target);
    if (normalized.length === 0) return null;

    const source = options.from === undefined ? undefined : byPath.get(options.from);
    const base = source === undefined ? null : linkBase(source);
    const explicitlyRelative = normalized.startsWith('./') || normalized.startsWith('../');
    const explicitlyAbsolute = normalized.startsWith('/');

    if (!explicitlyRelative) {
      const direct = byPath.get(normalized.replace(/^\/+/, ''));
      if (direct !== undefined) return direct;
    }
    if (!explicitlyAbsolute) {
      const joined = joinRelative(normalized, base);
      if (joined !== null) {
        const relative = byPath.get(joined);
        if (relative !== undefined) return relative;
      }
    }
    if (explicitlyRelative || explicitlyAbsolute) return null;

    const parts = segments(normalized);
    const last = (parts[parts.length - 1] ?? '').toLowerCase();
    const byFileName = unique(byBase.get(last));
    if (byFileName !== null) return byFileName;
    return unique(byTitle.get(normalized.toLowerCase()));
  };

  return {
    resolve,
    byPath: (pagePath) => byPath.get(pagePath) ?? null,
  };
}

// ---------------------------------------------------------------------------
// wikilink rendering
// ---------------------------------------------------------------------------

export interface WikilinkTarget {
  href: string;
  title?: string;
}

export type WikilinkResolver = (target: string, alias: string | undefined) => WikilinkTarget | null;

function escapeLinkText(text: string): string {
  return text.replace(/([[\]])/g, '\\$1');
}

function hasUnbalancedParens(href: string): boolean {
  let open = 0;
  for (const char of href) {
    if (char === '(') open += 1;
    if (char === ')') {
      open -= 1;
      if (open < 0) return true;
    }
  }
  return open !== 0;
}

/**
 * Whitespace, a leading `<`, or a paren the reader cannot pair all end the destination early.
 * Angle brackets fix all three. Balanced parens are legal bare, so leave those as written.
 */
function escapeLinkHref(href: string): string {
  const bare = !/\s/.test(href) && !href.startsWith('<') && !hasUnbalancedParens(href);
  if (bare) return href;
  return `<${href.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

/**
 * Rewrite `[[page]]` and `[[page|alias]]` into ordinary markdown links.
 * A target the resolver does not know is left untouched, so a broken link stays visible.
 */
export function resolveWikilinks(markdown: string, resolver: WikilinkResolver): string {
  const masked = maskCodeRegions(markdown);
  let out = '';
  let cursor = 0;
  WIKILINK.lastIndex = 0;
  for (let match = WIKILINK.exec(masked); match !== null; match = WIKILINK.exec(masked)) {
    const target = (match[1] ?? '').trim();
    const rawAlias = match[2];
    const alias = rawAlias === undefined ? undefined : rawAlias.trim();
    const resolved = target.length === 0 ? null : resolver(target, alias);
    out += markdown.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    if (resolved === null) {
      out += markdown.slice(match.index, cursor);
      continue;
    }
    const text = alias !== undefined && alias.length > 0 ? alias : (resolved.title ?? target);
    out += `[${escapeLinkText(text)}](${escapeLinkHref(resolved.href)})`;
  }
  out += markdown.slice(cursor);
  return out;
}

// ---------------------------------------------------------------------------
// backlinks
// ---------------------------------------------------------------------------

export interface LinkedPage extends LinkablePage {
  markdown: string;
}

/**
 * Map every page id to the pages that link to it. A page never backlinks to itself, and two
 * links from the same source count once.
 */
export function buildBacklinkIndex(pages: Iterable<LinkedPage>): Map<PageId, Backlink[]> {
  const list = [...pages];
  const resolver = createPageResolver(list);
  const backlinks = new Map<PageId, Backlink[]>();
  const seen = new Set<string>();

  for (const page of list) {
    for (const link of extractLinks(page.markdown)) {
      const target = resolver.resolve(link.target, { from: page.path });
      if (target === null) continue;
      if (target.id === page.id) continue;
      const key = `${target.id} <- ${page.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = backlinks.get(target.id);
      const entry: Backlink = { id: page.id, path: page.path, title: page.title };
      if (bucket === undefined) backlinks.set(target.id, [entry]);
      else bucket.push(entry);
    }
  }

  for (const bucket of backlinks.values()) {
    bucket.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  return backlinks;
}
