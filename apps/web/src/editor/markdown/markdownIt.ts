import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { HANDLE_PATTERN } from '@gitdocs/shared';
import { DATA, isCalloutType } from './dialect';
import { encodeRaw, escapeHtml } from './html';

export const LANG_PREFIX = 'language-';

const NEWLINE = 0x0a;
const SPACE = 0x20;
const TAB = 0x09;
const BACKSLASH = 0x5c;
const BRACKET = 0x5b;
const AT = 0x40;

/** markdown-it instances are reused across parses; only configure each one once. */
const configured = new WeakSet<MarkdownIt>();

/**
 * Teach markdown-it the gitdocs dialect. Everything here exists to keep source
 * detail that plain HTML would throw away: break markers, fence widths, list
 * markers, emphasis markers, raw HTML and wikilinks.
 */
export function configureMarkdownIt(md: MarkdownIt): MarkdownIt {
  if (configured.has(md)) return md;
  configured.add(md);

  md.set({ langPrefix: LANG_PREFIX });

  // Percent-encoding a destination rewrites bytes the author chose. Keep
  // validateLink, which is the part that blocks javascript: URLs.
  md.normalizeLink = (url) => url;
  md.normalizeLinkText = (url) => url;

  // `&amp;` must survive as `&amp;`, so entity expansion has to go.
  md.disable('entity', true);

  // A reference link resolves to an inline link and its definition line is
  // consumed, so the file would lose two constructs on the first save. Left off,
  // both stay literal text and come back byte for byte.
  md.disable('reference', true);

  md.inline.ruler.before('newline', 'gd_break', breakRule);
  md.inline.ruler.before('link', 'gd_wikilink', wikilinkRule);
  md.inline.ruler.before('link', 'gd_mention', mentionRule);

  // No `alt` list, so the rule never interrupts an open paragraph. `Intro:\n![[a]]`
  // stays one paragraph, which is what every other markdown reader sees.
  md.block.ruler.before('paragraph', 'gd_pageembed', pageEmbedRule);

  // Escapes have to be claimed before `text_join` folds them into plain text.
  md.core.ruler.before('text_join', 'gd_escape', escapeRule);
  md.core.ruler.push('gd_markup', markupRule);
  md.core.ruler.push('gd_callout', calloutRule);
  md.core.ruler.push('gd_tasklist', taskListRule);
  md.core.ruler.push('gd_listtight', listTightRule);
  // After `gd_listtight`, which reads the very flag this rule clears.
  md.core.ruler.push('gd_itemparagraph', itemParagraphRule);

  installRenderers(md);
  return md;
}

// ---------------------------------------------------------------------------
// inline rules
// ---------------------------------------------------------------------------

function isSpaceCode(code: number): boolean {
  return code === SPACE || code === TAB;
}

/**
 * Replaces markdown-it's `newline` rule so the exact break bytes survive: the
 * backslash or the run of trailing spaces, plus the newline itself. The marker
 * is the literal source of the break, so the serializer just writes it back.
 */
function breakRule(state: StateInline, silent: boolean): boolean {
  const code = state.src.charCodeAt(state.pos);

  if (code === BACKSLASH) {
    if (state.src.charCodeAt(state.pos + 1) !== NEWLINE) return false;
    if (!silent) pushBreak(state, 'hardbreak', '\\\n');
    state.pos = skipIndent(state, state.pos + 2);
    return true;
  }

  if (code !== NEWLINE) return false;
  if (!silent) {
    // `state.push` flushes pending text, so the trailing run has to go first.
    const spaces = trailingSpaces(state.pending);
    state.pending = state.pending.slice(0, state.pending.length - spaces.length);
    pushBreak(state, spaces.length >= 2 ? 'hardbreak' : 'softbreak', `${spaces}\n`);
  }
  state.pos = skipIndent(state, state.pos + 1);
  return true;
}

function pushBreak(state: StateInline, type: 'hardbreak' | 'softbreak', markup: string): void {
  const token = state.push(type, 'br', 0);
  token.markup = markup;
}

function trailingSpaces(pending: string): string {
  let start = pending.length;
  while (start > 0 && pending.charCodeAt(start - 1) === SPACE) start -= 1;
  return pending.slice(start);
}

function skipIndent(state: StateInline, from: number): number {
  let pos = from;
  while (pos < state.posMax && isSpaceCode(state.src.charCodeAt(pos))) pos += 1;
  return pos;
}

const WIKILINK_RE = /^\[\[([^[\]\r\n|]+)(?:\|([^[\]\r\n]*))?\]\]/;

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== BRACKET) return false;
  if (state.src.charCodeAt(state.pos + 1) !== BRACKET) return false;

  const match = WIKILINK_RE.exec(state.src.slice(state.pos, state.posMax));
  if (!match) return false;

  const target = match[1] ?? '';
  const alias = match[2];

  if (!silent) {
    const token = state.push('gd_wikilink', 'a', 0);
    token.markup = '[[';
    token.content = target;
    token.attrSet(DATA.wikilink, target);
    if (alias !== undefined) token.attrSet(DATA.alias, alias);
  }

  state.pos += match[0].length;
  return true;
}

const MENTION_RE = new RegExp(`^@(${HANDLE_PATTERN})`, 'i');

/** Only at the start of a word, so `mail@example.com` is an address and not a mention. */
const MENTION_OPENER_RE = /[\s([{<"'*_~]/;

function mentionRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== AT) return false;

  const before = state.pos === 0 ? '' : state.src.charAt(state.pos - 1);
  if (before !== '' && !MENTION_OPENER_RE.test(before)) return false;

  const match = MENTION_RE.exec(state.src.slice(state.pos, state.posMax));
  if (!match) return false;

  if (!silent) {
    const handle = match[1] ?? '';
    const token = state.push('gd_mention', 'span', 0);
    token.markup = '@';
    token.content = handle;
    token.attrSet(DATA.mention, handle);
  }

  state.pos += match[0].length;
  return true;
}

// ---------------------------------------------------------------------------
// block rules
// ---------------------------------------------------------------------------

/**
 * `![[path]]` alone on a line, the whole page embedded in this one. The line has to
 * match to the byte: a trailing space would be dropped on the way back out, and the
 * paragraph this then stays is written back unchanged.
 */
const PAGE_EMBED_RE = /^!\[\[([^[\]\r\n|]+)\]\]$/;

function pageEmbedRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  // Four columns in it is an indented code block, whoever wrote it.
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= 4) return false;

  const from = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
  const match = PAGE_EMBED_RE.exec(state.src.slice(from, state.eMarks[startLine] ?? from));
  if (!match) return false;
  if (silent) return true;

  const token = state.push('gd_pageembed', 'div', 0);
  token.map = [startLine, startLine + 1];
  token.markup = '![[';
  token.attrSet(DATA.embed, match[1] ?? '');
  state.line = startLine + 1;
  return true;
}

// ---------------------------------------------------------------------------
// core rules
// ---------------------------------------------------------------------------

const ESCAPE_TOKEN = 'gd_escape';

/**
 * A backslash escape survives nowhere in a CommonMark tree: `\*` and `*` both
 * become the character. Claiming the token here keeps the backslash as a mark on
 * the character, so a file that escapes more than it has to is written back
 * unchanged instead of being quietly normalised.
 */
function escapeRule(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    for (const child of token.children ?? []) {
      if (child.type !== 'text_special' || child.info !== 'escape') continue;
      // `\ ` and `\<non-punctuation>` keep their backslash in the content already.
      if (child.markup !== `\\${child.content}`) continue;
      child.type = ESCAPE_TOKEN;
    }
  }
}

/** Copies source markers onto tokens so the serializer can reproduce them. */
function markupRule(state: StateCore): void {
  let lines: string[] | null = null;
  // How many quotes wrote a prefix onto the lines this token sits on.
  let quotes = 0;

  for (const token of state.tokens) {
    if (token.type === 'blockquote_close') quotes -= 1;

    if (token.nesting >= 0 && token.map && token.type !== 'inline') {
      lines = lines ?? state.src.split('\n');
      const gap = blankLinesBefore(lines, token.map[0], quotes);
      // One blank line is the default separation and is not stored. Zero is, so a
      // heading and the line under it are not pushed apart on the first save.
      if (gap !== 1) token.attrSet(DATA.gap, String(gap));
    }
    // Counted after its own gap: the lines above a quote are outside it.
    if (token.type === 'blockquote_open') {
      quotes += 1;
      continue;
    }
    if (token.type === 'bullet_list_open') {
      token.attrSet(DATA.marker, token.markup);
      continue;
    }
    if (token.type === 'ordered_list_open') {
      token.attrSet(DATA.delimiter, token.markup);
      continue;
    }
    // markdown-it parks the item's own source number here. Without it the serializer
    // renumbers from the list's start, and `1./1./1.` becomes `1./2./3.` on every save.
    if (token.type === 'list_item_open' && token.info.length > 0) {
      token.attrSet(DATA.number, token.info);
      continue;
    }
    if (token.type === 'table_open') {
      lines = lines ?? state.src.split('\n');
      const delimiter = delimiterRow(lines, token);
      if (delimiter) token.attrSet(DATA.delims, delimiter);
      const rows = sourceRows(lines, token);
      if (rows) token.attrSet(DATA.rows, encodeRaw(rows));
      continue;
    }
    // Only at the top level: deeper down the leading run also carries the container's
    // own indent, and writing that back inside `wrapBlock` doubles it on every save.
    if (token.type === 'code_block' && token.level === 0) {
      lines = lines ?? state.src.split('\n');
      const indent = codeIndent(lines, token);
      if (indent) token.attrSet(DATA.indent, encodeRaw(indent));
      continue;
    }
    if (token.type === 'hr') {
      lines = lines ?? state.src.split('\n');
      token.attrSet(DATA.markup, ruleMarkup(lines, token));
      continue;
    }
    if (token.type === 'heading_open') {
      lines = lines ?? state.src.split('\n');
      const underline = setextUnderline(lines, token);
      if (underline) token.attrSet(DATA.setext, underline);
      const headingTrail = underline ? trailingWhitespace(lines, token) : atxTail(lines, token);
      if (headingTrail) token.attrSet(DATA.trail, encodeRaw(headingTrail));
      continue;
    }
    // A hidden paragraph is the one inside a tight list item. It renders no element, so an
    // attribute set here would never reach the document.
    if (token.type === 'paragraph_open' && !token.hidden) {
      lines = lines ?? state.src.split('\n');
      const trail = trailingWhitespace(lines, token);
      if (trail) token.attrSet(DATA.trail, encodeRaw(trail));
      continue;
    }
    if (token.type !== 'inline') continue;

    for (const child of token.children ?? []) {
      if (child.type === 'em_open' || child.type === 'strong_open') {
        child.attrSet(DATA.marker, child.markup);
        continue;
      }
      if (child.type === 'link_open') {
        // Record both answers. Without the explicit 'false' the serializer falls back to a
        // heuristic and rewrites `[https://e.com](https://e.com)` as a bare autolink.
        child.attrSet(DATA.autolink, child.markup === 'autolink' ? 'true' : 'false');
      }
    }
  }
}

/** A parser keeps no record of how many blank lines separated two blocks. */
function blankLinesBefore(lines: string[], startLine: number, quotes: number): number {
  let count = 0;
  let index = startLine - 1;
  while (index >= 0 && isBlankLine(lines[index] ?? '', quotes)) {
    count += 1;
    index -= 1;
  }
  return count;
}

/**
 * A separator line inside a quote still carries its `>` markers, so a plain trim never
 * calls it blank. Only the markers the enclosing quotes wrote may be stripped: a lone `>`
 * at the top level is an empty blockquote, not a blank line.
 */
function isBlankLine(line: string, quotes: number): boolean {
  let index = 0;
  for (let depth = 0; depth < quotes; depth += 1) {
    while (line[index] === ' ' || line[index] === '\t') index += 1;
    if (line[index] !== '>') break;
    index += 1;
  }
  return line.slice(index).trim().length === 0;
}

/** markdown-it trims a paragraph before parsing it, so the last line's tail is read back out. */
function trailingWhitespace(lines: string[], token: Token): string | null {
  const map = token.map;
  if (!map) return null;
  const line = lines[map[1] - 1];
  if (typeof line !== 'string') return null;
  if (line.trim().length === 0) return null;
  return /[ \t]+$/.exec(line)?.[0] ?? null;
}

/**
 * Everything an ATX heading line holds after its text: the optional closing run
 * of hashes and any trailing spaces. Both are dropped by the parser.
 */
function atxTail(lines: string[], token: Token): string | null {
  const map = token.map;
  if (!map) return null;
  const line = lines[map[0]];
  if (typeof line !== 'string') return null;
  return /(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[0] || null;
}

/**
 * The four columns markdown-it strips off an indented code block. A tab spans to the next
 * multiple of four, so one file spends a byte where another spends four. Anything past the
 * fourth column stays in the content and must not be captured twice.
 */
function codeIndent(lines: string[], token: Token): string | null {
  const line = token.map ? lines[token.map[0]] : undefined;
  if (typeof line !== 'string') return null;
  let columns = 0;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === ' ') columns += 1;
    else if (char === '\t') columns += 4 - (columns % 4);
    else return null;
    if (columns >= 4) return line.slice(0, i + 1);
  }
  return null;
}

const RULE_LINE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * `token.markup` is the marker repeated, so `- - -` comes back as `---`. The source line
 * holds the spelling the file used. Inside a quote or a list item the container's own
 * prefix is dropped, because `wrapBlock` writes it again.
 */
function ruleMarkup(lines: string[], token: Token): string {
  const line = token.map ? lines[token.map[0]] : undefined;
  if (typeof line !== 'string') return token.markup;
  const stripped = token.level === 0 ? line : line.replace(/^[ \t>]*/, '');
  const source = stripped.replace(/[ \t]+$/, '');
  return RULE_LINE.test(source) ? source : token.markup;
}

/** `=` / `-` underlines only; the run is read back out of the source line. */
function setextUnderline(lines: string[], token: Token): string | null {
  if (token.markup !== '=' && token.markup !== '-') return null;
  const map = token.map;
  if (!map) return null;
  const line = lines[map[1] - 1];
  if (typeof line !== 'string') return null;
  // At the top level the indent is part of the underline: dropping it rewrites the line on
  // the first save. Inside a quote or a list item the leading run is the container's own
  // prefix, which `wrapBlock` writes again, so it must not be stored twice.
  const candidate = token.level === 0 ? line : line.replace(/^[ \t>]*/, '');
  const match = /^([ \t]*(?:=+|-+))[ \t]*$/.exec(candidate);
  return match?.[1] ?? null;
}

/** Whatever a container wrote before the block's own content on the line. */
const CONTAINER_PREFIX = /^[ \t>]*/;

/**
 * The `| --- | :-: |` line under a table header, exactly as written. The parser keeps only the
 * alignments, so without this every table is reformatted to one canonical spelling on save.
 */
function delimiterRow(lines: string[], token: Token): string | null {
  const map = token.map;
  if (!map) return null;
  const line = lines[map[0] + 1];
  if (typeof line !== 'string') return null;
  // A delimiter cell can never start with `>`, so the leading run is the quote's own prefix.
  const row = line.replace(CONTAINER_PREFIX, '').trim();
  if (row.length === 0 || !/^[-:| \t]+$/.test(row)) return null;
  return row;
}

/**
 * Every line of the table as the file wrote it. The parser trims each cell before it parses
 * the inline content, so cell padding, ragged widths and one-sided pipes can only be
 * reproduced from the source rows.
 */
function sourceRows(lines: string[], token: Token): string | null {
  const map = token.map;
  if (!map) return null;
  const rows: string[] = [];
  for (let index = map[0]; index < map[1]; index += 1) {
    const line = lines[index];
    if (typeof line !== 'string') return null;
    rows.push(line.replace(CONTAINER_PREFIX, ''));
  }
  return rows.length > 0 ? rows.join('\n') : null;
}

const ALERT_RE = /^\[!([A-Za-z]+)\][ \t]*$/;

/** GitHub alert blockquotes become callout blocks. */
function calloutRule(state: StateCore): void {
  const tokens = state.tokens;

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.type !== 'blockquote_open') continue;
    if (tokens[i + 1]?.type !== 'paragraph_open') continue;

    const inline = tokens[i + 2];
    if (!inline || inline.type !== 'inline') continue;

    const children = inline.children ?? [];
    const first = children[0];
    if (!first || first.type !== 'text') continue;

    const match = ALERT_RE.exec(first.content);
    const kind = match?.[1]?.toUpperCase();
    if (!kind || !isCalloutType(kind)) continue;

    // GitHub wants the marker alone on its line. `[!NOTE] **Bold** title` leaves the text
    // child holding only `[!NOTE] `, so the regex passes while the line carries a title.
    const after = children[1]?.type;
    if (after !== undefined && after !== 'softbreak' && after !== 'hardbreak') continue;

    tokens[i]?.attrSet(DATA.callout, kind);
    // The keyword is matched case-insensitively, so its source casing travels alongside the
    // normalised kind: `[!note]` must not come back as `[!NOTE]`.
    tokens[i]?.attrSet(DATA.marker, match?.[1] ?? kind);

    const rest = children.slice(1);
    const next = rest[0]?.type;
    if (next === 'softbreak' || next === 'hardbreak') rest.shift();

    if (rest.length === 0) {
      tokens.splice(i + 1, 3);
      continue;
    }
    inline.children = rest;
    inline.content = '';
  }
}

const TASK_RE = /^\[([ xX])\](\s|$)/;

/** GFM task list items. Written by hand so the `X` casing and tightness survive. */
function taskListRule(state: StateCore): void {
  const tokens = state.tokens;
  const open: number[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    // `1. [ ] a` is a task list as much as `- [ ] a` is, so both list kinds are tracked.
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      open.push(i);
      continue;
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      open.pop();
      continue;
    }
    if (token.type !== 'list_item_open') continue;

    const listIndex = open[open.length - 1];
    if (listIndex === undefined) continue;
    if (tokens[i + 1]?.type !== 'paragraph_open') continue;

    const inline = tokens[i + 2];
    if (!inline || inline.type !== 'inline') continue;

    const first = inline.children?.[0];
    if (!first || first.type !== 'text') continue;

    const match = TASK_RE.exec(first.content);
    if (!match) continue;

    const marker = match[1] ?? ' ';
    first.content = first.content.slice(match[0].length);
    inline.content = inline.content.slice(match[0].length);

    token.attrSet('data-type', 'taskItem');
    token.attrSet('data-checked', marker === ' ' ? 'false' : 'true');
    if (marker === 'X') token.attrSet(DATA.marker, 'X');
    tokens[listIndex]?.attrSet('data-type', 'taskList');
  }
}

/**
 * Records the tightness markdown-it computed. A tight list hides its items' paragraphs and
 * says nothing else, so a list whose items hold no paragraph at all - only headings, fences
 * or nested lists - renders exactly like the loose form and the HTML probe cannot tell them
 * apart.
 */
function listTightRule(state: StateCore): void {
  const tokens = state.tokens;
  let lines: string[] | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token?.type !== 'bullet_list_open' && token?.type !== 'ordered_list_open') continue;
    lines = lines ?? state.src.split('\n');
    token.attrSet('data-tight', String(listIsTight(tokens, i, lines)));
  }
}

function listIsTight(tokens: Token[], listIndex: number, lines: string[]): boolean {
  const level = tokens[listIndex]?.level ?? 0;
  const maps: number[][] = [];

  for (let i = listIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.level <= level) break;
    // Direct children of the items. Anything deeper belongs to a nested container.
    if (token.level !== level + 2 || token.nesting < 0) continue;
    if (token.type === 'paragraph_open') return token.hidden;
    if (token.map) maps.push(token.map);
  }

  // No paragraph to read, so the blank line between two blocks is the only evidence left.
  for (let i = 1; i < maps.length; i += 1) {
    const from = maps[i - 1]?.[1] ?? 0;
    const to = maps[i]?.[0] ?? 0;
    for (let line = from; line < to; line += 1) {
      if ((lines[line] ?? '').trim().length === 0) return false;
    }
  }
  return true;
}

/**
 * A tight list hides its items' paragraphs, and a hidden token renders no element, so every
 * attribute on it is lost. Only an item's first block can do without one: a later paragraph
 * needs an element to carry the blank-line run that comes before it.
 */
function itemParagraphRule(state: StateCore): void {
  const tokens = state.tokens;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token?.type !== 'paragraph_open' || !token.hidden) continue;
    if (tokens[i - 1]?.type === 'list_item_open') continue;
    token.hidden = false;
    const close = tokens[i + 2];
    if (close?.type === 'paragraph_close') close.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// renderers
// ---------------------------------------------------------------------------

function installRenderers(md: MarkdownIt): void {
  const rules = md.renderer.rules;

  // The marker holds a newline, so it travels percent-encoded rather than raw.
  const renderBreak = (tokens: Token[], idx: number): string =>
    `<br ${DATA.break}="${encodeRaw(tokens[idx]?.markup ?? '\n')}">`;

  rules['softbreak'] = renderBreak;
  rules['hardbreak'] = renderBreak;

  rules[ESCAPE_TOKEN] = (tokens, idx) =>
    `<span ${DATA.escape}="">${escapeHtml(tokens[idx]?.content ?? '')}</span>`;

  rules['fence'] = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    return renderCode(token, token.content, token.markup, token.info ?? '');
  };

  rules['code_block'] = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    return renderCode(token, token.content, '', '');
  };

  rules['html_block'] = (tokens, idx) => {
    const token = tokens[idx];
    const raw = token?.content ?? '';
    const html = encodeRaw(raw.replace(/\n+$/, ''));
    return `<div ${DATA.html}="${html}"${gapAttr(token)}></div>`;
  };

  rules['html_inline'] = (tokens, idx) => {
    // Every inline tag is captured, not only comments. Left live, `<b>` would come
    // back as `**`, and a tag the schema has no rule for, like `<kbd>`, would be
    // dropped: both rewrite the file the moment it is opened.
    const raw = tokens[idx]?.content ?? '';
    return `<span ${DATA.html}="${encodeRaw(raw)}"></span>`;
  };

  // `alt` is the image label flattened to plain text, so `![a *b* c]` comes back as `a b c`
  // and every escape inside the label is lost. The raw label source travels alongside it.
  const defaultImage = rules['image'];
  rules['image'] = (tokens, idx, options, env, self) => {
    tokens[idx]?.attrSet(DATA.label, encodeRaw(tokens[idx]?.content ?? ''));
    if (defaultImage) return defaultImage(tokens, idx, options, env, self);
    return self.renderToken(tokens, idx, options);
  };

  rules['gd_pageembed'] = (tokens, idx) => {
    const token = tokens[idx];
    const target = token?.attrGet(DATA.embed) ?? '';
    return `<div ${DATA.embed}="${escapeHtml(target)}"${gapAttr(token)}></div>`;
  };

  rules['gd_mention'] = (tokens, idx) => {
    const handle = tokens[idx]?.attrGet(DATA.mention) ?? '';
    return `<span ${DATA.mention}="${escapeHtml(handle)}">@${escapeHtml(handle)}</span>`;
  };

  rules['gd_wikilink'] = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    const target = token.attrGet(DATA.wikilink) ?? '';
    const alias = token.attrGet(DATA.alias);
    const aliasAttr = alias === null ? '' : ` ${DATA.alias}="${escapeHtml(alias)}"`;
    const label = alias === null || alias === '' ? target : alias;
    return `<a ${DATA.wikilink}="${escapeHtml(target)}"${aliasAttr}>${escapeHtml(label)}</a>`;
  };
}

function renderCode(token: Token, rawContent: string, fence: string, info: string): string {
  const content = rawContent.endsWith('\n') ? rawContent.slice(0, -1) : rawContent;
  const language = info.trim().split(/\s+/)[0] ?? '';
  const className = language ? ` class="${escapeHtml(LANG_PREFIX + language)}"` : '';
  const attrs = `${DATA.fence}="${escapeHtml(fence)}" ${DATA.info}="${escapeHtml(info)}"`;
  const extra = `${gapAttr(token)}${copyAttr(token, DATA.indent)}`;
  return `<pre ${attrs}${extra}><code${className}>${escapeHtml(content)}</code></pre>`;
}

/** The custom block renderers bypass `renderToken`, so the gap is copied by hand. */
function gapAttr(token: Token | undefined): string {
  return copyAttr(token, DATA.gap);
}

function copyAttr(token: Token | undefined, name: string): string {
  const value = token?.attrGet(name);
  return value === null || value === undefined ? '' : ` ${name}="${escapeHtml(value)}"`;
}
