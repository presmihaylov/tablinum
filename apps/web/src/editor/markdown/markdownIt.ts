import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { DATA, isCalloutType } from './dialect';
import { encodeRaw, escapeHtml } from './html';

export const LANG_PREFIX = 'language-';

const NEWLINE = 0x0a;
const SPACE = 0x20;
const TAB = 0x09;
const BACKSLASH = 0x5c;
const BRACKET = 0x5b;

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

  // Escapes have to be claimed before `text_join` folds them into plain text.
  md.core.ruler.before('text_join', 'gd_escape', escapeRule);
  md.core.ruler.push('gd_markup', markupRule);
  md.core.ruler.push('gd_callout', calloutRule);
  md.core.ruler.push('gd_tasklist', taskListRule);

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

  for (const token of state.tokens) {
    if (token.level === 0 && token.nesting >= 0 && token.map) {
      lines = lines ?? state.src.split('\n');
      const gap = blankLinesBefore(lines, token.map[0]);
      // One blank line is the default separation and is not stored. Zero is, so a
      // heading and the line under it are not pushed apart on the first save.
      if (gap !== 1) token.attrSet(DATA.gap, String(gap));
    }
    if (token.type === 'bullet_list_open') {
      token.attrSet(DATA.marker, token.markup);
      continue;
    }
    if (token.type === 'ordered_list_open') {
      token.attrSet(DATA.delimiter, token.markup);
      continue;
    }
    if (token.type === 'table_open') {
      lines = lines ?? state.src.split('\n');
      const delimiter = delimiterRow(lines, token);
      if (delimiter) token.attrSet(DATA.delims, delimiter);
      continue;
    }
    if (token.type === 'hr') {
      token.attrSet(DATA.markup, token.markup);
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
      if (child.type === 'link_open' && child.markup === 'autolink') {
        child.attrSet(DATA.autolink, 'true');
      }
    }
  }
}

/**
 * A parser keeps no record of how many blank lines separated two blocks. Only
 * top-level blocks are measured: inside a quote or a list a "blank" line still
 * carries the container's own prefix, which is not whitespace.
 */
function blankLinesBefore(lines: string[], startLine: number): number {
  let count = 0;
  let index = startLine - 1;
  while (index >= 0 && (lines[index] ?? '').trim().length === 0) {
    count += 1;
    index -= 1;
  }
  return count;
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

/** `=` / `-` underlines only; the run is read back out of the source line. */
function setextUnderline(lines: string[], token: Token): string | null {
  if (token.markup !== '=' && token.markup !== '-') return null;
  const map = token.map;
  if (!map) return null;
  const line = lines[map[1] - 1];
  if (typeof line !== 'string') return null;
  // The indent is part of the underline: dropping it rewrites the line on the first save.
  const match = /^([ \t]*(?:=+|-+))[ \t]*$/.exec(line);
  return match?.[1] ?? null;
}

/**
 * The `| --- | :-: |` line under a table header, exactly as written. The parser keeps only the
 * alignments, so without this every table is reformatted to one canonical spelling on save.
 */
function delimiterRow(lines: string[], token: Token): string | null {
  const map = token.map;
  if (!map) return null;
  const line = lines[map[0] + 1];
  if (typeof line !== 'string') return null;
  const row = line.trim();
  if (row.length === 0 || !/^[-:| \t]+$/.test(row)) return null;
  return row;
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
  return `<pre ${attrs}${gapAttr(token)}><code${className}>${escapeHtml(content)}</code></pre>`;
}

/** The custom block renderers bypass `renderToken`, so the gap is copied by hand. */
function gapAttr(token: Token | undefined): string {
  const gap = token?.attrGet(DATA.gap);
  return gap === null || gap === undefined ? '' : ` ${DATA.gap}="${escapeHtml(gap)}"`;
}
