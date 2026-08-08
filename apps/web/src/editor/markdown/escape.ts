import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { configureMarkdownIt } from './markdownIt';

/**
 * Escaping decides whether a run of plain text can be written to markdown as-is.
 * A blanket escape would rewrite `2 * 3` as `2 \* 3` and churn every file, so the
 * text is re-parsed instead: if markdown-it reads it back as one plain text token,
 * the original bytes are safe and go out untouched.
 */
export interface EscapeContext {
  /** The run begins a line, so block openers matter. */
  lineStart: boolean;
  /** The run follows a break inside the same block. */
  continuation: boolean;
  /** Inside a GFM table cell, where a bare pipe would split the row. */
  inTable: boolean;
  /** The run shares a block with other inline nodes, so delimiters can join up. */
  edgeRisk: boolean;
  /** Inside a link label, where an unescaped bracket would close the label early. */
  inLink?: boolean;
  /**
   * The caller knows the surrounding block would re-read this run as syntax
   * (an alert marker in a blockquote, a checkbox in a list item).
   */
  force?: boolean;
}

let probe: MarkdownIt | null = null;

function probeParser(): MarkdownIt {
  probe = probe ?? configureMarkdownIt(new MarkdownIt({ html: true, linkify: false, breaks: false }));
  return probe;
}

const INLINE_SUSPECT = /[\\`*_~[\]<>&!]/;
const LINE_SUSPECT = /^[ \t]*(?:[-*+=#>]|\d{1,9}[.)]|~{3}|`{3})/;
const EDGE_DELIMITER = /^[*_~`]|[*_~`]$/;
const SETEXT_LINE = /^[ \t]*(?:=+|-+)[ \t]*$/;

export function escapeText(value: string, context: EscapeContext): string {
  const escaped = mustEscape(value, context)
    ? fullEscape(value, context.lineStart)
    : bracketGuard(value, context);
  if (!context.inTable) return escaped;
  return escaped.replace(/\|/g, '\\|');
}

/** The probe reads a run in isolation, so it cannot see the enclosing `[...]`. */
function bracketGuard(value: string, context: EscapeContext): string {
  if (context.inLink !== true) return value;
  return value.replace(/([[\]])/g, '\\$1');
}

function mustEscape(value: string, context: EscapeContext): boolean {
  if (value.length === 0) return false;
  if (context.force === true) return true;
  if (!isSuspect(value, context)) return false;
  if (context.edgeRisk && EDGE_DELIMITER.test(value)) return true;
  return !readsBackAsPlainText(value, context);
}

function isSuspect(value: string, context: EscapeContext): boolean {
  if (INLINE_SUSPECT.test(value)) return true;
  return context.lineStart && LINE_SUSPECT.test(value);
}

/** True when markdown-it turns the string into exactly one plain text token. */
function readsBackAsPlainText(value: string, context: EscapeContext): boolean {
  // A `===` line right after a break would silently promote the block to a heading.
  if (context.continuation && context.lineStart && SETEXT_LINE.test(value)) return false;

  const md = probeParser();
  if (context.continuation && context.lineStart) return readsBackAsContinuation(md, value);

  const inline = context.lineStart ? paragraphInline(md, value) : soleInline(md, value);
  if (!inline) return false;

  const children = inline.children ?? [];
  if (children.length !== 1) return false;
  const only = children[0];
  if (only?.type !== 'text') return false;
  return only.content === probedText(value, context.lineStart);
}

/**
 * markdown-it's block parser drops the trailing horizontal whitespace of a paragraph line,
 * so the identity compare has to drop it too. Exactly `[ \t]`, never a newline: anything
 * wider would hide a real difference and under-escape.
 */
function probedText(value: string, viaBlockParser: boolean): string {
  return viaBlockParser ? value.replace(/[ \t]+$/, '') : value;
}

/** A line the file wrote under another line of the same block, never on its own. */
const CONTINUATION_ANCHOR = 'gd';

/**
 * Not every block opener can interrupt a paragraph: `2. two` under `1. one` is a lazy
 * continuation line, not a list, so escaping it would add a backslash the author never typed.
 * Probing the line together with a line above it is what tells the two cases apart.
 */
function readsBackAsContinuation(md: MarkdownIt, value: string): boolean {
  const inline = paragraphInline(md, `${CONTINUATION_ANCHOR}\n${value}`);
  if (!inline) return false;

  const children = inline.children ?? [];
  if (children.length !== 3) return false;
  if (children[0]?.type !== 'text' || children[0]?.content !== CONTINUATION_ANCHOR) return false;
  if (children[1]?.type !== 'softbreak') return false;
  const last = children[2];
  if (last?.type !== 'text') return false;
  return last.content === probedText(value, true);
}

function paragraphInline(md: MarkdownIt, value: string): Token | null {
  const tokens = md.parse(value, {});
  if (tokens.length !== 3) return null;
  if (tokens[0]?.type !== 'paragraph_open') return null;
  const inline = tokens[1];
  return inline?.type === 'inline' ? inline : null;
}

function soleInline(md: MarkdownIt, value: string): Token | null {
  const tokens = md.parseInline(value, {});
  if (tokens.length !== 1) return null;
  const inline = tokens[0];
  return inline?.type === 'inline' ? inline : null;
}

const ESCAPABLE = /[`*\\~[\]_<>]/g;
const WORD = /\w/;

function fullEscape(value: string, lineStart: boolean): string {
  const escaped = value.replace(ESCAPABLE, (char: string, offset: number) => {
    if (char !== '_') return `\\${char}`;
    const before = value[offset - 1];
    const after = value[offset + 1];
    // Intraword underscores are never emphasis, so leave `snake_case` alone.
    if (before && after && WORD.test(before) && WORD.test(after)) return char;
    return `\\${char}`;
  });

  if (!lineStart) return escaped;

  return escaped
    .replace(/^(\+[ ]|[-*>])/, '\\$&')
    .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*\d+)([.)])(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)(=+)([ \t]*)$/, '$1\\$2$3');
}

/** Text inside `[...]` labels only has to survive the bracket scanner. */
export function escapeLinkLabel(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}

function hasBalancedParens(href: string): boolean {
  let open = 0;
  for (const char of href) {
    if (char === '(') open += 1;
    if (char === ')') {
      open -= 1;
      if (open < 0) return false;
    }
  }
  return open === 0;
}

/** A destination with whitespace must be wrapped, which is also how it was written. */
export function formatDestination(href: string): string {
  if (href.length === 0) return '';
  if (/[\s<>]/.test(href)) return `<${href.replace(/([<>\\])/g, '\\$1')}>`;
  // A balanced run of parens is legal bare CommonMark and is how the author wrote it.
  // An unbalanced one would end the destination early, so that still needs a backslash.
  if (hasBalancedParens(href)) return href;
  return href.replace(/([()])/g, '\\$1');
}

export function formatTitle(title: string | null): string {
  if (title === null) return '';
  if (!title.includes('"')) return ` "${title}"`;
  if (!title.includes("'")) return ` '${title}'`;
  return ` (${title.replace(/([()])/g, '\\$1')})`;
}
