import matter from 'gray-matter';
import {
  FrontmatterSchema,
  IsoDateSchema,
  isPageId,
  newPageId,
  type Frontmatter,
  type PageId,
} from '@tablinum/shared';
import { emitNumber, emitString, emitTimestamp } from './yaml-emit.js';

const BOM = String.fromCharCode(0xfeff);
const MAX_ICON_LENGTH = 16;
const HEADING_SCAN_LINES = 200;

export interface ParsedFile {
  frontmatter: Frontmatter;
  /** Body without the frontmatter block, normalized to LF with no surrounding blank lines. */
  body: string;
  /** The file exactly as it was read. */
  raw: string;
  /**
   * True when a value had to be invented or dropped. Such a file must be rewritten in
   * canonical form; its original bytes no longer carry everything we now know about the page.
   */
  repaired: boolean;
  /**
   * True when a `---` block was present but YAML refused it. Such a file is never rewritten
   * automatically: the author has to fix the quoting, and a rewrite would duplicate the block
   * into the body and mint a second id.
   */
  blockBroken: boolean;
}

export interface ParseHints {
  /** Page slug used to derive a title when the file carries none. */
  filename?: string;
  /** Clock used for generated timestamps. */
  now?: Date;
  /**
   * Id to adopt when the file carries none. Without it every read of the same id-less file
   * would invent a different id.
   */
  fallbackId?: PageId;
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/** Strip the frontmatter block, then repair whatever the author left out. Never throws. */
export function parse(raw: string, hints: ParseHints = {}): ParsedFile {
  const stripped = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;
  // gray-matter splits the first line on /\r?\n/. A CR-only file has no such line, so it
  // reports an empty body and `#persistRepairs` then rewrites the file without its prose.
  const text = stripped.replace(/\r\n?/g, '\n');
  const block = readMatter(text);
  const body = normalizeBody(block.content);
  const source = readBlockScalars(block.blockText);
  const built = buildFrontmatter(withSourceScalars(block.data, source), body, block.hadBlock, hints, source);
  const repaired = block.broken ? false : built.repaired;
  return { frontmatter: built.frontmatter, body, raw, repaired, blockBroken: block.broken };
}

interface MatterBlock {
  data: Record<string, unknown>;
  content: string;
  hadBlock: boolean;
  /** Raw text between the delimiters, empty when there was no block. */
  blockText: string;
  /** A block was present but YAML could not read it. */
  broken: boolean;
}

/** The opening `---` block of a file, without its delimiters. */
const BLOCK_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function extractBlockText(text: string): string {
  return BLOCK_RE.exec(text)?.[1] ?? '';
}

function readMatter(text: string): MatterBlock {
  let file;
  try {
    // Passing options disables gray-matter's global result cache, which hands out shared objects.
    file = matter(text, { language: 'yaml' });
  } catch {
    // Broken YAML. The block is still line-oriented, so the scalars are recovered from its
    // source text; the body is whatever follows the closing delimiter.
    const blockText = extractBlockText(text);
    const rest = text.slice(BLOCK_RE.exec(text)?.[0].length ?? 0);
    return { data: {}, content: blockText.length > 0 ? rest : text, hadBlock: true, blockText, broken: true };
  }

  const data: unknown = file.data;
  if (!isRecord(data)) {
    // The block parsed, but not as a mapping: the leading `---` was a thematic break, not
    // frontmatter. Taking file.content here would drop every byte gray-matter swallowed.
    return { data: {}, content: text, hadBlock: false, blockText: '', broken: false };
  }
  return {
    data,
    content: file.content,
    hadBlock: typeof file.matter === 'string',
    blockText: typeof file.matter === 'string' ? file.matter : '',
    broken: false,
  };
}

// ---------------------------------------------------------------------------
// source-text recovery
//
// js-yaml reads a frontmatter block with YAML 1.1 rules, where `0123` is octal 83 and `1.0`
// is the integer 1. The coerced value cannot be turned back into what the author typed, so the
// source line is kept alongside it and wins whenever the two disagree.
// ---------------------------------------------------------------------------

interface BlockScalars {
  /** Source text of every simple `key: value` line at column 0. */
  top: Map<string, string>;
}

const EMPTY_SCALARS: BlockScalars = { top: new Map() };

const KEY_LINE_RE = /^([ \t]*)([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:(?:[ \t]+(.*))?$/;
/** A value YAML would not read as a one-line plain scalar. */
const NOT_PLAIN_RE = /^["'[\]{}|>&*!#%@`~]/;

function plainScalarSource(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (NOT_PLAIN_RE.test(trimmed)) return null;
  if (trimmed.includes(' #')) return null; // a trailing comment is not part of the value
  return trimmed;
}

function readBlockScalars(blockText: string): BlockScalars {
  if (blockText.length === 0) return EMPTY_SCALARS;
  const top = new Map<string, string>();
  const lines = blockText.replace(/\r\n/g, '\n').split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) continue;
    const match = KEY_LINE_RE.exec(line);
    if (match === null) continue;
    if ((match[1] ?? '').length > 0) continue;
    const value = plainScalarSource(match[3]);
    const next = lines[index + 1] ?? '';
    // An indented follow-on line means a multi-line scalar or a nested map, neither of which
    // this reader can reproduce.
    const continues = /^[ \t]/.test(next) && next.trim().length > 0 && KEY_LINE_RE.exec(next) === null;
    if (!continues && value !== null) top.set(match[2] ?? '', value);
  }

  return { top };
}

/** How the emitter would write a scalar YAML handed back. Null when there is no plain form. */
function canonicalScalar(value: unknown): string | null {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return emitNumber(value);
  return null;
}

/** The author's own text, when YAML turned it into something that cannot be written back. */
function sourceOverride(parsed: unknown, source: string | null): string | null {
  if (source === null) return null;
  if (typeof parsed === 'string') return null;
  if (parsed === null) return null;
  if (canonicalScalar(parsed) === source) return null;
  return source;
}

/** Fill in keys YAML never produced. Only a broken block reaches this with anything to add. */
function withSourceScalars(
  data: Record<string, unknown>,
  source: BlockScalars,
): Record<string, unknown> {
  if (source.top.size === 0) return data;
  const merged: Record<string, unknown> = { ...data };
  for (const [key, value] of source.top) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Whitespace-only leading lines too, not just bare newlines: a closing `---` with a
    // trailing space leaves one behind. The line must be blank, so an indented code block
    // that opens the body keeps its indent.
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/[ \t\n]+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  return true;
}

/** Turn a slug into a readable title: "getting-started" -> "Getting started". */
export function titleize(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (words.length === 0) return 'Untitled';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** First level-one heading of a markdown body, ignoring fenced code. */
export function firstHeading(body: string): string | null {
  const lines = body.split('\n');
  const limit = Math.min(lines.length, HEADING_SCAN_LINES);
  let fence: string | null = null;
  for (let index = 0; index < limit; index += 1) {
    const line = lines[index] ?? '';
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (fenceMatch && (fenceMatch[1] ?? '').startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = (fenceMatch[1] ?? '').slice(0, 3);
      continue;
    }
    const atx = /^ {0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (atx) {
      const title = (atx[1] ?? '').trim();
      if (title.length > 0) return title;
    }
    const next = lines[index + 1];
    if (line.trim().length > 0 && next !== undefined && /^ {0,3}=+[ \t]*$/.test(next)) {
      return line.trim();
    }
  }
  return null;
}

interface IsoResult {
  iso: string | null;
  /** False when the on-disk form differs from what we would write. */
  exact: boolean;
}

function toIso(value: unknown): IsoResult {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) return { iso: null, exact: false };
    return { iso: value.toISOString(), exact: true };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { iso: new Date(value).toISOString(), exact: false };
  }
  if (typeof value !== 'string') return { iso: null, exact: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { iso: null, exact: false };
  if (IsoDateSchema.safeParse(trimmed).success) return { iso: trimmed, exact: trimmed === value };
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return { iso: null, exact: false };
  return { iso: parsed.toISOString(), exact: false };
}

/** Trim an icon the same way the parser does. Returns null when nothing is left. */
export function normalizeIcon(icon: string): string | null {
  const trimmed = icon.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ICON_LENGTH) return null;
  return trimmed;
}

interface BuildResult {
  frontmatter: Frontmatter;
  repaired: boolean;
}

function buildFrontmatter(
  data: Record<string, unknown>,
  body: string,
  hadBlock: boolean,
  hints: ParseHints,
  source: BlockScalars = EMPTY_SCALARS,
): BuildResult {
  let repaired = !hadBlock;
  const nowIso = (hints.now ?? new Date()).toISOString();

  const rawId = data['id'];
  let id: string = isPageId(rawId) ? rawId : '';
  if (id.length === 0) {
    const fallback = hints.fallbackId;
    id = isPageId(fallback) ? fallback : newPageId();
    repaired = true;
  }

  const title = readTitle(data['title'], source.top.get('title') ?? null, body, hints);
  if (!title.exact) repaired = true;

  const icon = readIcon(data['icon']);
  if (!icon.exact) repaired = true;

  const order = readOrder(data['order'], source.top.get('order') ?? null);
  if (!order.exact) repaired = true;

  const createdResult = toIso(data['created']);
  const updatedResult = toIso(data['updated']);
  if (!createdResult.exact || !updatedResult.exact) repaired = true;
  const created = createdResult.iso ?? updatedResult.iso ?? nowIso;
  const updated = updatedResult.iso ?? created;

  const frontmatter: Frontmatter = { id, title: title.value, created, updated };
  if (icon.value !== null) frontmatter.icon = icon.value;
  if (order.value !== null) frontmatter.order = order.value;

  if (FrontmatterSchema.safeParse(frontmatter).success) return { frontmatter, repaired };
  return {
    frontmatter: { id: newPageId(), title: 'Untitled', created: nowIso, updated: nowIso },
    repaired: true,
  };
}

function readTitle(
  raw: unknown,
  source: string | null,
  body: string,
  hints: ParseHints,
): { value: string; exact: boolean } {
  if (typeof raw === 'string' && raw.trim().length > 0) return { value: raw, exact: true };
  // A number or a date in this field is a real title that YAML coerced. The source line still
  // holds what the author typed, and it reads back as the same string, so nothing is repaired.
  if (typeof raw !== 'string' && raw !== null && source !== null) {
    return { value: source, exact: true };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: String(raw), exact: false };
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { value: raw.toISOString(), exact: false };
  }
  const derived = firstHeading(body) ?? titleize(hints.filename ?? '');
  return { value: derived.length > 0 ? derived : 'Untitled', exact: false };
}

function readIcon(raw: unknown): { value: string | null; exact: boolean } {
  if (raw === undefined || raw === null) return { value: null, exact: true };
  if (typeof raw !== 'string') return { value: null, exact: false };
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ICON_LENGTH) return { value: null, exact: false };
  return { value: trimmed, exact: trimmed === raw };
}

function readOrder(raw: unknown, source: string | null = null): { value: number | null; exact: boolean } {
  if (raw === undefined || raw === null) return { value: null, exact: true };
  // js-yaml follows YAML 1.1, where a leading zero means octal: `order: 010` reads as 8 and
  // sorts before `order: 09`, which is not octal at all and comes back as a string. A human
  // writing a zero-padded number means decimal, so the source text decides.
  const padded = (source ?? (typeof raw === 'string' ? raw : '')).trim();
  if (/^0\d+$/.test(padded)) return { value: Number.parseInt(padded, 10), exact: true };
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw, exact: true };
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return { value: parsed, exact: false };
  }
  return { value: null, exact: false };
}

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

/** Render the frontmatter block in the contract's key order. */
export function stringifyFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = [];
  lines.push(`id: ${emitString(frontmatter.id)}`);
  lines.push(`title: ${emitString(frontmatter.title)}`);
  if (frontmatter.icon !== undefined && frontmatter.icon !== null && frontmatter.icon.length > 0) {
    // Always quoted: an emoji next to a YAML indicator is easy to misread, quoted is never wrong.
    lines.push(`icon: ${JSON.stringify(frontmatter.icon)}`);
  }
  if (frontmatter.order !== undefined && frontmatter.order !== null) {
    lines.push(`order: ${emitNumber(frontmatter.order)}`);
  }
  lines.push(`created: ${emitTimestamp(frontmatter.created)}`);
  lines.push(`updated: ${emitTimestamp(frontmatter.updated)}`);
  return lines.join('\n');
}

/** A complete page file: frontmatter block, blank line, body, trailing newline. */
export function serialize(frontmatter: Frontmatter, body: string): string {
  const block = stringifyFrontmatter(frontmatter);
  const normalized = normalizeBody(body);
  if (normalized.length === 0) return `---\n${block}\n---\n`;
  return `---\n${block}\n---\n\n${normalized}\n`;
}

/**
 * Serialize, but hand back the original bytes when nothing about the page changed.
 * Opening and saving a hand-written file must never produce a git diff.
 */
export function serializePreserving(
  previous: ParsedFile | null,
  frontmatter: Frontmatter,
  body: string,
): string {
  if (
    previous !== null &&
    !previous.repaired &&
    previous.body === normalizeBody(body) &&
    frontmatterEqual(previous.frontmatter, frontmatter)
  ) {
    return previous.raw;
  }
  return serialize(frontmatter, body);
}

/** Deep equality over the frontmatter contract. */
export function frontmatterEqual(a: Frontmatter, b: Frontmatter): boolean {
  if (a.id !== b.id) return false;
  if (a.title !== b.title) return false;
  if ((a.icon ?? null) !== (b.icon ?? null)) return false;
  if ((a.order ?? null) !== (b.order ?? null)) return false;
  if (a.created !== b.created) return false;
  return a.updated === b.updated;
}
