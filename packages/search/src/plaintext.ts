/**
 * Markdown -> readable prose, for the search index and its snippets.
 * The index must never hold markup: FTS5 would tokenize `](https` as words and
 * snippet() would return half a link.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape the five characters that change meaning inside HTML text. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const RAW_BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const AUTOLINK_RE = /<((?:https?|ftp|mailto):[^>\s]+)>/gi;
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const FOOTNOTE_REF_RE = /\[\^[^\]\n]+\]/g;
const FOOTNOTE_DEFINITION_RE = /^[ \t]{0,3}\[\^[^\]\n]+\]:[ \t]*/gm;
// One level of nested brackets in the text, one level of balanced parens in the
// destination. Both are legal CommonMark and both used to leave a raw URL in the index.
const LINK_BODY = String.raw`\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)`;
const IMAGE_RE = new RegExp(`!${LINK_BODY}`, 'g');
const INLINE_LINK_RE = new RegExp(LINK_BODY, 'g');
const REFERENCE_LINK_RE = /\[([^\]]*)\]\[[^\]]*\]/g;
const WIKILINK_ALIAS_RE = /\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g;
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;
// Bounded on both axes: an unbounded run of backticks backtracks quadratically, and a
// page body is attacker-supplied. Inline code that spans a line is not indexed as code.
const INLINE_CODE_RE = /(`{1,3})([^`\n]{1,500}?)\1(?!`)/g;

const LINK_DEFINITION_RE = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S+.*$/;
const HORIZONTAL_RULE_RE =
  /^[ \t]{0,3}(?:\*[ \t]*){3,}$|^[ \t]{0,3}(?:-[ \t]*){3,}$|^[ \t]{0,3}(?:_[ \t]*){3,}$|^[ \t]{0,3}={2,}[ \t]*$/;
const TABLE_DIVIDER_RE = /^[ \t]{0,3}\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/;
const HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+/;
const HEADING_TRAIL_RE = /[ \t]+#+[ \t]*$/;
const BLOCKQUOTE_RE = /^[ \t]{0,3}(?:>[ \t]?)+/;
const LIST_MARKER_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const TASK_BOX_RE = /^\[[ xX]\][ \t]+/;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;

// Everything unprintable except \n and \t. Snippet delimiters are control codes,
// so indexed text must not contain any of its own.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const HORIZONTAL_SPACE_RE = /[ \t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\u200b\ufeff]+/g;
const BACKSLASH_ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!>~|"'])/g;

/** Drop fenced code blocks, including an unterminated final fence. */
function stripCodeFences(text: string): string {
  const kept: string[] = [];
  let fenceChar = '';
  let fenceLength = 0;
  for (const line of text.split('\n')) {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fenceLength === 0) {
      if (marker !== undefined) {
        fenceChar = marker[0] ?? '`';
        fenceLength = marker.length;
        continue;
      }
      kept.push(line);
      continue;
    }
    if (marker !== undefined && marker[0] === fenceChar && marker.length >= fenceLength) {
      fenceChar = '';
      fenceLength = 0;
    }
  }
  return kept.join('\n');
}

// Each rule stops at a newline and at a fixed width. `[\s\S]*?` across a whole body
// backtracks quadratically. Emphasis wrapped over a line break stays in the index verbatim.
function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*\*([^\s*][^\n]{0,500}?)\*\*\*/g, '$1')
    .replace(/\*\*([^\s*][^\n]{0,500}?)\*\*/g, '$1')
    .replace(/\*([^\s*][^\n]{0,500}?)\*/g, '$1')
    .replace(/~~([^\n]{1,500}?)~~/g, '$1')
    .replace(/(?<![\w\\])__([^\s_][^\n]{0,500}?)__(?!\w)/g, '$1')
    .replace(/(?<![\w\\])_([^\s_][^\n]{0,500}?)_(?!\w)/g, '$1');
}

/** Remove the per-line markdown scaffolding: headings, quotes, bullets, rules, tables. */
function stripBlockMarkers(text: string): string {
  const kept: string[] = [];
  for (const raw of text.split('\n')) {
    if (LINK_DEFINITION_RE.test(raw)) continue;
    if (HORIZONTAL_RULE_RE.test(raw)) continue;
    if (TABLE_DIVIDER_RE.test(raw)) continue;
    const withoutQuote = raw.replace(BLOCKQUOTE_RE, '');
    const withoutHeading = withoutQuote.replace(HEADING_RE, '').replace(HEADING_TRAIL_RE, '');
    const withoutBullet = withoutHeading.replace(LIST_MARKER_RE, '').replace(TASK_BOX_RE, '');
    // `\|` is an escaped pipe, not a cell edge. Leave it whole for BACKSLASH_ESCAPE_RE,
    // which runs later and would otherwise strand the backslash.
    kept.push(withoutBullet.replace(/\\.|\|/g, (match) => (match === '|' ? ' ' : match)));
  }
  return kept.join('\n');
}

/** Squeeze runs of spaces and blank lines so snippets stay compact. */
function collapseWhitespace(text: string): string {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(HORIZONTAL_SPACE_RE, ' ').trim();
    if (line.length === 0 && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/** Longest body the indexer reads. A snippet never needs more, and it bounds every regex. */
const MAX_INDEX_CHARS = 256 * 1024;

export interface PlainTextOptions {
  /**
   * Strip a leading `---` block. Off by default: the indexer passes a stored body that
   * `ContentStore` already split off its frontmatter, and such a body may legitimately
   * open with a thematic break. Only a caller holding a whole file should turn this on.
   */
  stripFrontmatter?: boolean;
}

/**
 * Convert a markdown document to plain prose.
 * Code fences, HTML and link syntax are removed; the visible words survive.
 * A body longer than MAX_INDEX_CHARS is truncated: the page still saves, only its index is cut.
 */
export function markdownToPlainText(markdown: string, options: PlainTextOptions = {}): string {
  if (typeof markdown !== 'string' || markdown.length === 0) return '';

  let text = markdown.slice(0, MAX_INDEX_CHARS).replace(/\r\n?/g, '\n');
  if (options.stripFrontmatter === true) text = text.replace(FRONTMATTER_RE, '');
  text = stripCodeFences(text);
  text = text.replace(HTML_COMMENT_RE, ' ');
  text = text.replace(RAW_BLOCK_RE, ' ');
  text = text.replace(AUTOLINK_RE, '$1');
  text = text.replace(HTML_TAG_RE, ' ');
  // Before FOOTNOTE_REF_RE, which would otherwise eat the `[^1]` and leave a bare `:`.
  text = text.replace(FOOTNOTE_DEFINITION_RE, '');
  text = text.replace(FOOTNOTE_REF_RE, ' ');
  text = text.replace(IMAGE_RE, '$1');
  text = text.replace(INLINE_LINK_RE, '$1');
  text = text.replace(REFERENCE_LINK_RE, '$1');
  text = text.replace(WIKILINK_ALIAS_RE, '$2');
  text = text.replace(WIKILINK_RE, '$1');
  text = text.replace(INLINE_CODE_RE, '$2');
  text = stripBlockMarkers(text);
  text = stripEmphasis(text);
  text = text.replace(BACKSLASH_ESCAPE_RE, '$1');
  text = text.replace(CONTROL_CHARS_RE, ' ');
  return collapseWhitespace(text);
}
