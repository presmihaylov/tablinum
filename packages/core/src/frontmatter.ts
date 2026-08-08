import matter from 'gray-matter';
import {
  FrontmatterSchema,
  IsoDateSchema,
  isPageId,
  newPageId,
  type Frontmatter,
  type PageId,
  type PropValue,
} from '@gitdocs/shared';
import {
  emitFlowSequence,
  emitKey,
  emitNumber,
  emitPropValue,
  emitString,
  emitTimestamp,
} from './yaml-emit.js';

const BOM = String.fromCharCode(0xfeff);
const MAX_ICON_LENGTH = 16;
const MAX_TAG_LENGTH = 64;
const HEADING_SCAN_LINES = 200;

/** Keys the contract gives a fixed meaning. Anything else folds into `props`. */
const RESERVED_KEYS = new Set([
  'id',
  'title',
  'icon',
  'tags',
  'order',
  'created',
  'updated',
  'props',
]);

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
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;
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
  /** Source text of every simple `key: value` line one level under `props:`. */
  props: Map<string, string>;
}

const EMPTY_SCALARS: BlockScalars = { top: new Map(), props: new Map() };

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
  const props = new Map<string, string>();
  const lines = blockText.replace(/\r\n/g, '\n').split('\n');
  let inProps = false;
  let propsIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) continue;
    const match = KEY_LINE_RE.exec(line);
    if (match === null) {
      inProps = false;
      continue;
    }
    const indent = (match[1] ?? '').length;
    const key = match[2] ?? '';
    const value = plainScalarSource(match[3]);
    const next = lines[index + 1] ?? '';
    // An indented follow-on line means a multi-line scalar or a nested map, neither of which
    // this reader can reproduce.
    const continues = /^[ \t]/.test(next) && next.trim().length > 0 && KEY_LINE_RE.exec(next) === null;

    if (indent === 0) {
      inProps = key === 'props' && match[3] === undefined;
      propsIndent = -1;
      if (!continues && value !== null) top.set(key, value);
      continue;
    }
    if (!inProps) continue;
    if (propsIndent === -1) propsIndent = indent;
    if (indent !== propsIndent) continue;
    if (!continues && value !== null) props.set(key, value);
  }

  return { top, props };
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
  if (source.top.size === 0 && source.props.size === 0) return data;
  const merged: Record<string, unknown> = { ...data };
  for (const [key, value] of source.top) {
    if (merged[key] === undefined) merged[key] = value;
  }
  if (source.props.size === 0) return merged;
  const parsedProps = isRecord(merged['props']) ? merged['props'] : {};
  const props: Record<string, unknown> = { ...parsedProps };
  for (const [key, value] of source.props) {
    if (props[key] === undefined) props[key] = value;
  }
  merged['props'] = props;
  return merged;
}

export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\n+/, '')
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

interface PropResult {
  value: PropValue;
  exact: boolean;
}

function toPropValue(value: unknown): PropResult | null {
  if (value === null) return { value: null, exact: true };
  if (typeof value === 'string') return { value, exact: true };
  if (typeof value === 'boolean') return { value, exact: true };
  if (typeof value === 'number') return { value, exact: true };
  if (value instanceof Date) return { value: value.toISOString(), exact: false };
  if (!Array.isArray(value)) {
    // PropValue has no nested shape. Keep the author's data as its JSON text rather than
    // deleting it, and leave the file alone until something else asks for a rewrite.
    return { value: JSON.stringify(value), exact: true };
  }
  const list: unknown[] = value;
  const items: string[] = [];
  let exact = true;
  for (const item of list) {
    if (typeof item === 'string') {
      items.push(item);
      continue;
    }
    if (typeof item === 'number' || typeof item === 'boolean') {
      items.push(String(item));
      exact = false;
      continue;
    }
    if (item instanceof Date) {
      items.push(item.toISOString());
      exact = false;
      continue;
    }
    items.push(JSON.stringify(item));
    exact = false;
  }
  return { value: items, exact };
}

function normalizeTag(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_TAG_LENGTH);
}

/**
 * Trim tags and drop the empty ones. The parser normalizes the same way, so a tag written
 * through here reads back unchanged instead of looking like a repair on the next save.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (normalized !== null) out.push(normalized);
  }
  return out;
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

  const tags = readTags(data['tags']);
  if (!tags.exact) repaired = true;

  const order = readOrder(data['order']);
  if (!order.exact) repaired = true;

  const createdResult = toIso(data['created']);
  const updatedResult = toIso(data['updated']);
  if (!createdResult.exact || !updatedResult.exact) repaired = true;
  const created = createdResult.iso ?? updatedResult.iso ?? nowIso;
  const updated = updatedResult.iso ?? created;

  const props = readProps(data, source.props);
  if (!props.exact) repaired = true;

  const frontmatter: Frontmatter = { id, title: title.value, created, updated };
  if (icon.value !== null) frontmatter.icon = icon.value;
  if (tags.value.length > 0) frontmatter.tags = tags.value;
  if (order.value !== null) frontmatter.order = order.value;
  if (Object.keys(props.value).length > 0) frontmatter.props = props.value;

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

function readTags(raw: unknown): { value: string[]; exact: boolean } {
  if (raw === undefined || raw === null) return { value: [], exact: true };
  if (typeof raw === 'string') {
    const split = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return { value: split, exact: false };
  }
  if (!Array.isArray(raw)) return { value: [], exact: false };
  const list: unknown[] = raw;
  const tags: string[] = [];
  let exact = true;
  for (const item of list) {
    const tag = normalizeTag(item);
    if (tag === null) {
      exact = false;
      continue;
    }
    if (item !== tag) exact = false;
    tags.push(tag);
  }
  return { value: tags, exact };
}

function readOrder(raw: unknown): { value: number | null; exact: boolean } {
  if (raw === undefined || raw === null) return { value: null, exact: true };
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw, exact: true };
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return { value: parsed, exact: false };
  }
  return { value: null, exact: false };
}

function readProps(
  data: Record<string, unknown>,
  source: ReadonlyMap<string, string> = EMPTY_SCALARS.props,
): {
  value: Record<string, PropValue>;
  exact: boolean;
} {
  const props: Record<string, PropValue> = {};
  let exact = true;

  const raw = data['props'];
  if (raw !== undefined && raw !== null && !isRecord(raw)) exact = false;
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (key.length === 0) {
        exact = false;
        continue;
      }
      const recovered = sourceOverride(value, source.get(key) ?? null);
      if (recovered !== null) {
        props[key] = recovered;
        continue;
      }
      const converted = toPropValue(value);
      if (converted === null) {
        exact = false;
        continue;
      }
      if (!converted.exact) exact = false;
      props[key] = converted.value;
    }
  }

  // An agent writing a bare .md file puts its own keys at the top level. Keep them as props
  // instead of throwing the author's data away.
  for (const [key, value] of Object.entries(data)) {
    if (RESERVED_KEYS.has(key)) continue;
    exact = false;
    if (key.length === 0) continue;
    if (Object.prototype.hasOwnProperty.call(props, key)) continue;
    const converted = toPropValue(value);
    if (converted === null) continue;
    props[key] = converted.value;
  }

  return { value: props, exact };
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
  const tags = frontmatter.tags;
  if (tags !== undefined && tags.length > 0) lines.push(`tags: ${emitFlowSequence(tags)}`);
  if (frontmatter.order !== undefined && frontmatter.order !== null) {
    lines.push(`order: ${emitNumber(frontmatter.order)}`);
  }
  lines.push(`created: ${emitTimestamp(frontmatter.created)}`);
  lines.push(`updated: ${emitTimestamp(frontmatter.updated)}`);
  const props = frontmatter.props;
  if (props !== undefined && Object.keys(props).length > 0) {
    lines.push('props:');
    for (const [key, value] of Object.entries(props)) {
      lines.push(`  ${emitKey(key)}: ${emitPropValue(value)}`);
    }
  }
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

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function samePropValue(a: PropValue, b: PropValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return sameStrings(a, b);
  }
  return a === b;
}

/** Deep equality over the frontmatter contract, including prop key order. */
export function frontmatterEqual(a: Frontmatter, b: Frontmatter): boolean {
  if (a.id !== b.id) return false;
  if (a.title !== b.title) return false;
  if ((a.icon ?? null) !== (b.icon ?? null)) return false;
  if ((a.order ?? null) !== (b.order ?? null)) return false;
  if (a.created !== b.created) return false;
  if (a.updated !== b.updated) return false;
  if (!sameStrings(a.tags ?? [], b.tags ?? [])) return false;

  const aProps = a.props ?? {};
  const bProps = b.props ?? {};
  const aKeys = Object.keys(aProps);
  const bKeys = Object.keys(bProps);
  if (!sameStrings(aKeys, bKeys)) return false;
  return aKeys.every((key) => samePropValue(aProps[key] ?? null, bProps[key] ?? null));
}
