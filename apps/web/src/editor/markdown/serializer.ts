import { MarkdownSerializer } from '@tiptap/pm/markdown';
import type { Fragment, Mark, Node as PMNode, Schema } from '@tiptap/pm/model';
import { escapeLinkLabel, escapeText, formatDestination, formatTitle } from './escape';
import {
  isCalloutType,
  numberAttr,
  rawStringAttr,
  stringAttr,
  toCalloutType,
} from './dialect';

type NodeSerializers = ConstructorParameters<typeof MarkdownSerializer>[0];
type MarkSerializers = ConstructorParameters<typeof MarkdownSerializer>[1];
type SerializerState = Parameters<NodeSerializers[string]>[0];

/**
 * Per-serialisation scratch state. It carries the facts a node serializer cannot
 * read off the ProseMirror node itself: the enclosing block context, and the set
 * of text nodes whose leading characters the parent block would re-read as syntax.
 */
interface Scratch {
  inTable: boolean;
  blockLineStart: boolean;
  /** A checkbox has just been written, so the next paragraph does not open a line. */
  afterCheckbox: boolean;
  autolink: boolean;
  forced: WeakSet<PMNode>;
}

export function serializeDoc(doc: PMNode): string {
  const scratch: Scratch = {
    inTable: false,
    blockLineStart: true,
    afterCheckbox: false,
    autolink: false,
    forced: new WeakSet<PMNode>(),
  };
  const serializer = new MarkdownSerializer(
    withGaps(nodeSerializers(scratch)),
    markSerializers(scratch),
    { hardBreakNodeName: 'hardBreak', strict: false },
  );
  return dropTightMarks(serializer.serialize(doc, { tightLists: true }));
}

/**
 * A block boundary the file wrote with no blank line. The serializer state has
 * already queued that blank line before any node serializer runs and exposes no
 * way to cancel it, so the boundary is marked and the extra newline is dropped
 * once the whole document is built.
 */
const TIGHT_MARK = '\u0000gd-tight\u0000';

/**
 * The blank separator line, plus the delimiter run that opens the marked line. `write` puts
 * the container's delimiter back after the blank line, so inside a quoted list the real
 * output is `\n>\n>   ` and a bare `\n\n` never matches.
 */
const TIGHT_SEPARATOR = new RegExp(`\\n[ \\t>]*\\n([ \\t>]*)${TIGHT_MARK}`, 'g');

function dropTightMarks(text: string): string {
  return text.replace(TIGHT_SEPARATOR, '\n$1').split(TIGHT_MARK).join('');
}

/** Clipboard copies hand over a slice; wrap it so the doc serializer can run. */
export function serializeFragment(fragment: Fragment, schema: Schema): string {
  const doc = wrapFragment(fragment, schema);
  if (!doc) return fragment.textBetween(0, fragment.size, '\n\n');
  return serializeDoc(doc);
}

function wrapFragment(fragment: Fragment, schema: Schema): PMNode | null {
  const paragraph = schema.nodes['paragraph'];
  try {
    if (fragment.firstChild?.isInline && paragraph) {
      return schema.topNodeType.create(null, paragraph.create(null, fragment));
    }
    return schema.topNodeType.create(null, fragment);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

/**
 * A run of blank lines between two top-level blocks is not part of either block,
 * so it is replayed here rather than inside any one serializer. The default
 * separation is a single blank line, which `closeBlock` already writes.
 */
function withGaps(serializers: NodeSerializers): NodeSerializers {
  const wrapped: NodeSerializers = {};
  for (const [name, render] of Object.entries(serializers)) {
    wrapped[name] = (state, node, parent, index) => {
      writeGap(state, node, parent, index);
      render(state, node, parent, index);
    };
  }
  return wrapped;
}

/**
 * The containers whose children record a blank-line run. A table cell is deliberately not
 * one: its paragraphs are written on one line and a replayed gap would break the row.
 */
const GAP_PARENTS = new Set(['doc', 'blockquote', 'callout', 'listItem', 'taskItem']);

function writeGap(
  state: SerializerState,
  node: PMNode,
  parent: PMNode,
  index: number,
): void {
  if (index === 0 || !GAP_PARENTS.has(parent.type.name)) return;
  const gap = numberAttr(node.attrs['gap']);
  if (gap === null) return;
  if (gap > 1) {
    // Not a run of bare newlines: a blank line inside a container carries the delimiter,
    // trailing space trimmed off, which is exactly what `flushClose` writes.
    internals(state).flushClose(gap + 1);
    return;
  }
  // The blank line goes back in when the pair could read as one block, because an
  // edit above may have removed whatever kept the two apart in the file.
  if (gap === 0 && staysSplit(parent.child(index - 1), node)) state.text(TIGHT_MARK, false);
}

/** True when the two blocks stay two blocks with no blank line between them. */
function staysSplit(previous: PMNode, node: PMNode): boolean {
  return endsBlock(previous) || interrupts(node);
}

/** No following line can be read as a continuation of this block. */
function endsBlock(node: PMNode): boolean {
  const name = node.type.name;
  if (name === 'heading' || name === 'codeBlock' || name === 'horizontalRule') return true;
  // The embed is one whole line, so the line under it can only start a new block.
  if (name === 'pageEmbed') return true;
  return name === 'htmlBlock' && isComment(node);
}

/** This block opens with a marker strong enough to break the block above. */
function interrupts(node: PMNode): boolean {
  const name = node.type.name;
  if (name === 'heading') return setextRun(node) === null;
  if (name === 'horizontalRule') return true;
  // An indented code block reads as a continuation line, a fenced one does not.
  if (name === 'codeBlock') return rawStringAttr(node.attrs['fence']) !== '';
  if (name === 'table' || name === 'blockquote' || name === 'callout') return true;
  if (name === 'bulletList') return firstItemNonEmpty(node);
  // An ordered list may only interrupt a paragraph when it starts at one, and no list
  // may interrupt with an empty first item. `Intro:\n-\n` is a setext heading, not a list.
  if (name === 'orderedList' || name === 'taskList') {
    return startsAtOne(node) && firstItemNonEmpty(node);
  }
  return name === 'htmlBlock' && opensBlockHtml(node);
}

function startsAtOne(node: PMNode): boolean {
  if (node.type.name === 'taskList' && node.attrs['ordered'] !== true) return true;
  return (numberAttr(node.attrs['start']) ?? 1) === 1;
}

function firstItemNonEmpty(node: PMNode): boolean {
  return node.childCount > 0 && !itemIsEmpty(node, 0);
}

function isComment(node: PMNode): boolean {
  return (rawStringAttr(node.attrs['raw']) ?? '').startsWith('<!--');
}

/** CommonMark HTML block types 1 and 6, the tags that open a block on their own line. */
const BLOCK_HTML_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption',
  'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li',
  'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p',
  'param', 'pre', 'script', 'search', 'section', 'style', 'summary', 'table', 'tbody',
  'td', 'textarea', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
]);

/**
 * Types 1-6 interrupt a paragraph; type 7, an arbitrary tag on its own line, does not.
 * markdown-it folds `Before.\n<custom-tag>` into the paragraph above, so joining that
 * pair tight would make the file re-read as one block.
 */
function opensBlockHtml(node: PMNode): boolean {
  const raw = (rawStringAttr(node.attrs['raw']) ?? '').trimStart();
  if (/^<[?!]/.test(raw)) return true; // comments, declarations, CDATA and processing instructions
  const tag = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>]|$)/.exec(raw)?.[1];
  return tag !== undefined && BLOCK_HTML_TAGS.has(tag.toLowerCase());
}

function nodeSerializers(scratch: Scratch): NodeSerializers {
  return {
    text: (state, node, parent, index) => serializeText(scratch, state, node, parent, index),

    paragraph: (state, node) => {
      // Consumed once: the second paragraph of a loose task item really does open a
      // line, and it needs the escaping the first one must not get.
      scratch.blockLineStart = !scratch.afterCheckbox;
      scratch.afterCheckbox = false;
      state.renderInline(node);
      const trail = stringAttr(node.attrs['trail']);
      if (trail !== null) state.text(trail, false);
      state.closeBlock(node);
    },

    heading: (state, node) => serializeHeading(scratch, state, node),

    blockquote: (state, node) => {
      guardLeadingText(scratch, node, looksLikeAlert);
      // An empty quote is one `>`. The delimiter's space would be a trailing run on a
      // line that never receives content.
      const opener = isEmptyBlock(node) ? '>' : null;
      state.wrapBlock('> ', opener, node, () => state.renderContent(node));
    },

    callout: (state, node) => {
      state.wrapBlock('> ', null, node, () => {
        state.write(`[!${calloutKeyword(node)}]`);
        // An empty callout is one line. Opening a second one would leave a newline the
        // serializer never closes, and the document would grow by a byte on every save.
        if (isEmptyBlock(node)) return;
        state.ensureNewLine();
        state.renderContent(node);
      });
    },

    codeBlock: (state, node) => serializeCodeBlock(state, node),

    horizontalRule: (state, node) => {
      state.write(stringAttr(node.attrs['markup']) ?? '---');
      state.closeBlock(node);
    },

    hardBreak: (state, node, parent, index) => {
      for (let i = index + 1; i < parent.childCount; i += 1) {
        if (parent.child(i).type === node.type) continue;
        if (scratch.inTable) {
          state.write('<br>');
          return;
        }
        // The marker is the literal break source, newline included.
        state.text(rawStringAttr(node.attrs['marker']) ?? '\\\n', false);
        return;
      }
    },

    image: (state, node) => {
      const src = stringAttr(node.attrs['src']) ?? '';
      const alt = stringAttr(node.attrs['alt']) ?? '';
      const title = stringAttr(node.attrs['title']);
      // The label is the source the file held. `alt` is only its flattened text, so it is the
      // fallback for an image this session inserted rather than one it read.
      const label = rawStringAttr(node.attrs['label']) ?? escapeLinkLabel(alt);
      state.write(
        guardPipes(`![${label}](${formatDestination(src)}${formatTitle(title)})`, scratch.inTable),
      );
    },

    bulletList: (state, node) => {
      const marker = stringAttr(node.attrs['marker']) ?? '-';
      renderListNode(state, node, {
        delim: () => '  ',
        marker: (index) => (itemIsEmpty(node, index) ? marker : `${marker} `),
      });
    },

    orderedList: (state, node) => serializeOrderedList(state, node),

    listItem: (state, node) => {
      guardLeadingText(scratch, node, looksLikeCheckbox);
      state.renderContent(node);
    },

    taskList: (state, node) => {
      if (node.attrs['ordered'] === true) {
        serializeOrderedList(state, node);
        return;
      }
      const marker = stringAttr(node.attrs['marker']) ?? '-';
      renderListNode(state, node, { delim: () => '  ', marker: () => `${marker} ` });
    },

    taskItem: (state, node) => {
      // `- [ ]` with no label carries no space after the box; adding one is a trailing run
      // that most linters flag. A label made only of leaf nodes - a wikilink, an image, a
      // `<br>` - contributes no text, so the test is the item's own emptiness, not its text.
      state.write(isEmptyBlock(node) ? `[${checkbox(node)}]` : `[${checkbox(node)}] `);
      // The flag is consumed by the paragraph serializer. An item that opens with any other
      // block would leave it set and steal the escaping from a later paragraph.
      scratch.afterCheckbox = node.firstChild?.type.name === 'paragraph';
      state.renderContent(node);
      scratch.afterCheckbox = false;
    },

    table: (state, node) => serializeTable(scratch, state, node),

    tableRow: (state, node) => {
      state.renderContent(node);
    },

    tableHeader: (state, node) => {
      state.renderContent(node);
    },

    tableCell: (state, node) => {
      state.renderContent(node);
    },

    htmlBlock: (state, node) => {
      state.text(rawStringAttr(node.attrs['raw']) ?? '', false);
      state.closeBlock(node);
    },

    htmlInline: (state, node) => {
      state.text(guardPipes(rawStringAttr(node.attrs['raw']) ?? '', scratch.inTable), false);
    },

    pageEmbed: (state, node) => {
      state.write(`![[${stringAttr(node.attrs['target']) ?? ''}]]`);
      state.closeBlock(node);
    },

    wikilink: (state, node) => {
      const target = stringAttr(node.attrs['target']) ?? '';
      const alias = rawStringAttr(node.attrs['alias']);
      state.write(
        guardPipes(alias === null ? `[[${target}]]` : `[[${target}|${alias}]]`, scratch.inTable),
      );
    },
  };
}

/** The keyword as the file wrote it, unless the block has since been re-typed in the editor. */
function calloutKeyword(node: PMNode): string {
  const type = toCalloutType(node.attrs['type']);
  const label = stringAttr(node.attrs['label']);
  return label !== null && label.toUpperCase() === type ? label : type;
}

/**
 * A block that holds nothing but the empty paragraph the schema requires. `textContent`
 * alone is not enough: a block whose only child is a nested list, an image or a fence is
 * also empty by that test, and dropping a list marker's space there writes `-![a](/a.png)`.
 */
function isEmptyBlock(node: PMNode): boolean {
  const only = node.firstChild;
  return node.childCount === 1 && only?.type.name === 'paragraph' && only.content.size === 0;
}

const ALERT_LINE = /^\[!([A-Za-z]+)\][ \t]*$/;
const CHECKBOX_LINE = /^\[[ xX]\](\s|$)/;

/** An alert marker only re-reads as a callout when nothing else shares its line. */
function looksLikeAlert(text: string, aloneOnLine: boolean): boolean {
  if (!aloneOnLine) return false;
  const kind = ALERT_LINE.exec(text)?.[1];
  return kind !== undefined && isCalloutType(kind.toUpperCase());
}

/** A checkbox is claimed wherever it starts the item, title or no title. */
function looksLikeCheckbox(text: string): boolean {
  return CHECKBOX_LINE.test(text);
}

/**
 * A block's own opener changes how its first characters read on the way back in:
 * `> [!NOTE]` becomes a callout, `- [ ] x` becomes a task. Flag those runs so the
 * escaper writes them literally instead of trusting the isolated probe.
 */
function guardLeadingText(
  scratch: Scratch,
  block: PMNode,
  matches: (text: string, aloneOnLine: boolean) => boolean,
): void {
  const paragraph = block.firstChild;
  if (paragraph?.type.name !== 'paragraph') return;
  const first = paragraph.firstChild;
  if (!first?.isText) return;
  const alone = paragraph.childCount === 1 || paragraph.child(1).type.name === 'hardBreak';
  if (!matches(first.text ?? '', alone)) return;
  scratch.forced.add(first);
}

function serializeText(
  scratch: Scratch,
  state: SerializerState,
  node: PMNode,
  parent: PMNode,
  index: number,
): void {
  const previous = index > 0 ? parent.child(index - 1) : null;
  const afterBreak = previous?.type.name === 'hardBreak';
  const lines = (node.text ?? '').split('\n');
  // Inline code and autolink bodies are verbatim spans; escaping them adds bytes.
  const verbatim = scratch.autolink || node.marks.some((mark) => mark.type.name === 'code');
  const inLink = node.marks.some((mark) => mark.type.name === 'link');
  const forced = scratch.forced.has(node);

  // The file wrote every character of this run as a backslash escape.
  if (node.marks.some((mark) => mark.type.name === 'mdEscape')) {
    state.text(backslashEscape(node.text ?? ''), false);
    return;
  }

  lines.forEach((line, position) => {
    const first = position === 0;
    // A mark has already written its opening delimiter, so the run is not at column 0
    // and no block opener can fire there. Escaping it would add a backslash.
    const opensBlock = previous === null && scratch.blockLineStart && node.marks.length === 0;
    const lineStart = first ? afterBreak || opensBlock : true;
    const escaped = verbatim
      ? guardPipes(line, scratch.inTable)
      : escapeText(line, {
          lineStart,
          continuation: !first || afterBreak,
          inTable: scratch.inTable,
          edgeRisk: parent.childCount > 1,
          inLink,
          force: forced && first,
        });
    state.text(escaped, false);
    if (position < lines.length - 1) state.text('\n', false);
  });
}

function backslashEscape(text: string): string {
  return Array.from(text, (char) => `\\${char}`).join('');
}

/** A bare pipe ends the cell even inside code, so it is escaped there too. */
function guardPipes(line: string, inTable: boolean): string {
  if (!inTable) return line;
  return line.replace(/\|/g, '\\|');
}

/** The `=` or `-` underline the heading was written with, when it still fits. */
function setextRun(node: PMNode): string | null {
  const setext = stringAttr(node.attrs['setext']);
  if (setext === null || node.textContent.length === 0) return null;
  const level = numberAttr(node.attrs['level']) ?? 1;
  const run = setext.trimStart();
  if (level === 1 && run.startsWith('=')) return setext;
  if (level === 2 && run.startsWith('-')) return setext;
  return null;
}

function serializeHeading(scratch: Scratch, state: SerializerState, node: PMNode): void {
  const level = numberAttr(node.attrs['level']) ?? 1;
  const setext = setextRun(node);
  const trail = stringAttr(node.attrs['trail']);
  const hashes = '#'.repeat(Math.min(Math.max(level, 1), 6));

  // `#` alone is a heading too, and the space after it belongs to the trailing run.
  if (node.textContent.length === 0) {
    state.write(hashes);
    if (trail !== null) state.text(trail, false);
    state.closeBlock(node);
    return;
  }

  if (setext !== null) {
    scratch.blockLineStart = true;
    state.renderInline(node);
    state.ensureNewLine();
    state.write(setext);
    if (trail !== null) state.text(trail, false);
    state.closeBlock(node);
    return;
  }

  scratch.blockLineStart = false;
  state.write(`${hashes} `);
  state.renderInline(node, false);
  if (trail !== null) state.text(trail, false);
  state.closeBlock(node);
}

function serializeCodeBlock(state: SerializerState, node: PMNode): void {
  const info = rawStringAttr(node.attrs['info']) ?? stringAttr(node.attrs['language']) ?? '';
  const fence = rawStringAttr(node.attrs['fence']);
  const text = node.textContent;

  // An empty fence attribute marks an indented block. Blank lines stay blank,
  // so `wrapBlock` cannot be used: it would pad them with the four spaces.
  if (fence === '') {
    const indent = stringAttr(node.attrs['indent']) ?? '    ';
    const indented = text
      .split('\n')
      .map((line) => (line.length === 0 ? '' : `${indent}${line}`))
      .join('\n');
    state.text(indented, false);
    state.closeBlock(node);
    return;
  }

  const marker = fence !== null && fence.startsWith('~') ? '~' : '`';
  // Only a line that is nothing but markers can close the block, so a bare ``` inside a
  // line of code must not widen the fence.
  const width = Math.max(3, longestFenceLine(text, marker) + 1, fence?.length ?? 0);
  const bar = marker.repeat(width);

  state.write(bar + info);
  state.ensureNewLine();
  if (text.length > 0) {
    state.text(text, false);
    trimDanglingDelim(state);
    // Not `ensureNewLine`: the content's own last newline is a blank line the file wrote,
    // and reusing it as the closing fence's line deletes it.
    state.text('\n', false);
  }
  state.write(bar);
  state.closeBlock(node);
}

/**
 * `text()` opens each line with the delimiter. When the run ends on a newline that
 * delimiter starts a line that stays empty, so its trailing space is a trailing run -
 * the same one `flushClose` trims between two blocks.
 */
function trimDanglingDelim(state: SerializerState): void {
  const inner = internals(state);
  const delim = inner.delim;
  if (delim.length === 0 || !inner.out.endsWith(delim)) return;
  const head = inner.out.slice(0, inner.out.length - delim.length);
  if (head.length > 0 && !head.endsWith('\n')) return;
  inner.out = head + delim.replace(/[ \t]+$/, '');
}

/** Longest run of markers on a line that holds nothing else, so it could close the block. */
function longestFenceLine(text: string, marker: string): number {
  let best = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.split('').some((char) => char !== marker)) continue;
    best = Math.max(best, trimmed.length);
  }
  return best;
}

function longestRun(text: string, marker: string): number {
  let best = 0;
  let run = 0;
  for (const char of text) {
    run = char === marker ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * The shortest fence that cannot appear inside the span. The default serializer
 * always pads a span that holds a backtick, which rewrites ``` ``a ` b`` ``` as
 * ``` `` a ` b `` ```. A pad is only needed when the content would touch the
 * fence, or when its own edge spaces would be stripped on the way back in.
 */
function codeFence(parent: PMNode, index: number, open: boolean): string {
  const text = codeRunText(parent, index);
  const ticks = '`'.repeat(longestRun(text, '`') + 1);
  const pad = needsCodePad(text) ? ' ' : '';
  return open ? `${ticks}${pad}` : `${pad}${ticks}`;
}

function codeRunText(parent: PMNode, index: number): string {
  if (index < 0 || index >= parent.childCount) return '';
  let start = index;
  while (start > 0 && hasCodeMark(parent.child(start - 1))) start -= 1;
  let end = index;
  while (end + 1 < parent.childCount && hasCodeMark(parent.child(end + 1))) end += 1;

  let text = '';
  for (let i = start; i <= end; i += 1) text += parent.child(i).text ?? '';
  return text;
}

function hasCodeMark(node: PMNode): boolean {
  return node.marks.some((mark) => mark.type.name === 'code');
}

function needsCodePad(text: string): boolean {
  if (text.length === 0) return false;
  if (text.startsWith('`') || text.endsWith('`')) return true;
  // CommonMark strips one space from each end, but only if both ends have one.
  return text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text);
}

/**
 * These members are `@internal` in prosemirror-markdown and absent from its typings.
 * `renderList` is reimplemented below because it derives one continuation indent for a
 * whole ordered list, and that bookkeeping needs them.
 */
interface StateInternals {
  closed: PMNode | null;
  inTightList: boolean;
  delim: string;
  out: string;
  flushClose(size: number): void;
}

function internals(state: SerializerState): StateInternals {
  return state as unknown as StateInternals;
}

interface ListShape {
  /** Indent added to every line of the item after the first. */
  delim: (index: number) => string;
  /** The marker written before the item's first line, its trailing space included. */
  marker: (index: number) => string;
}

/**
 * `MarkdownSerializerState.renderList` with three corrections: a relaxed separator
 * between two lists that cannot merge, a tightness recomputed from the content being
 * written, and a per-item indent.
 */
function renderListNode(state: SerializerState, node: PMNode, shape: ListShape): void {
  const inner = internals(state);
  if (inner.closed && inner.closed.type === node.type) {
    // Two blank lines are what stop two sibling lists merging on re-parse. Lists that
    // already differ in marker or delimiter cannot merge, so one newline is enough.
    inner.flushClose(sameListSyntax(inner.closed, node) ? 3 : 1);
  } else if (inner.inTightList) {
    inner.flushClose(1);
  }

  const tight = isTightList(node);
  const previousTight = inner.inTightList;
  inner.inTightList = tight;
  node.forEach((child, _offset, index) => {
    // The gap between two items cannot go through `withGaps`: `wrapBlock` writes the marker
    // before the item's own serializer runs, so the blank lines would land after it.
    if (index > 0) inner.flushClose(itemSeparation(child, tight));
    state.wrapBlock(shape.delim(index), shape.marker(index), node, () =>
      state.render(child, node, index),
    );
  });
  inner.inTightList = previousTight;
}

/** A `flushClose` size: 1 writes no blank line, 2 writes one, 3 writes two. */
function itemSeparation(item: PMNode, tight: boolean): number {
  const gap = numberAttr(item.attrs['gap']);
  if (gap !== null) return gap + 1;
  return tight ? 1 : 2;
}

function sameListSyntax(previous: PMNode, node: PMNode): boolean {
  if (previous.attrs['ordered'] !== node.attrs['ordered']) return false;
  if (stringAttr(previous.attrs['marker']) !== stringAttr(node.attrs['marker'])) return false;
  return stringAttr(previous.attrs['delimiter']) === stringAttr(node.attrs['delimiter']);
}

/**
 * The stored `tight` flag goes stale: an edit can give an item a second paragraph without
 * clearing it, and the file would then be written in a form the parser reads back as
 * loose. A nested list is the one extra child a tight item may hold.
 */
function isTightList(node: PMNode): boolean {
  if (node.attrs['tight'] === false) return false;
  for (let index = 0; index < node.childCount; index += 1) {
    const item = node.child(index);
    for (let child = 1; child < item.childCount; child += 1) {
      if (!isListNode(item.child(child))) return false;
    }
  }
  return true;
}

function isListNode(node: PMNode): boolean {
  const name = node.type.name;
  return name === 'bulletList' || name === 'orderedList' || name === 'taskList';
}

/** A task item always writes its checkbox, so its marker's space is never trailing. */
function itemIsEmpty(list: PMNode, index: number): boolean {
  if (list.type.name === 'taskList') return false;
  return isEmptyBlock(list.child(index));
}

function serializeOrderedList(state: SerializerState, node: PMNode): void {
  const start = numberAttr(node.attrs['start']) ?? 1;
  const delimiter = stringAttr(node.attrs['delimiter']) === ')' ? ')' : '.';
  const numberAt = itemNumbering(node, start);

  // Markers are written flush left. A file almost never pads `9.` to line up with
  // `10.`, so aligning them here would rewrite the list the moment it is opened. The
  // continuation indent follows each item's own marker: one shared width writes an
  // indented code block under `9.` at the wrong column, and it grows on every save.
  renderListNode(state, node, {
    delim: (index) => state.repeat(' ', numberAt(index).length + 2),
    marker: (index) =>
      `${numberAt(index)}${delimiter}${itemIsEmpty(node, index) ? '' : ' '}`,
  });
}

/**
 * How each marker gets its number. The file's own numbers are written back while the list
 * still holds exactly the items it numbered, because numbering every item `1.` is a common
 * way to write markdown and renumbering would rewrite the list on the first page view. An
 * edit makes them stale - a new item has no number, and a removed or moved one leaves every
 * number after it wrong - so the list is then counted afresh from its start.
 */
function itemNumbering(node: PMNode, start: number): (index: number) => string {
  const count = (index: number): string => String(start + index);
  const source = sourceNumbers(node);
  if (source === null) return count;

  if (sameItems(source, node)) {
    return (index) => {
      const stored = source[index];
      return stored === undefined || stored === '' ? count(index) : stored;
    };
  }
  // The one style worth keeping through an edit: a file that numbers every item the same
  // way says nothing about position, so a new item joins it without disturbing the rest.
  const first = source[0] ?? '';
  const uniform = first !== '' && source.length > 1 && source.every((one) => one === first);
  return uniform ? () => first : count;
}

/** The item numbers the file held, or null for a list that did not come from one. */
function sourceNumbers(node: PMNode): string[] | null {
  const raw = stringAttr(node.attrs['sourceNumbers']);
  return raw === null ? null : raw.split(' ');
}

/** Whether the list still holds the numbered items, all of them, in the same order. */
function sameItems(source: string[], node: PMNode): boolean {
  if (source.length !== node.childCount) return false;
  return source.every(
    (number, index) => number === (stringAttr(node.child(index).attrs['number']) ?? ''),
  );
}

function checkbox(node: PMNode): string {
  if (node.attrs['checked'] !== true) return ' ';
  return stringAttr(node.attrs['marker']) === 'X' ? 'X' : 'x';
}

const ALIGN_DELIMITERS: Record<string, string> = {
  left: ':---',
  center: ':---:',
  right: '---:',
};

function serializeTable(scratch: Scratch, state: SerializerState, node: PMNode): void {
  const alignments = headerAlignments(node);
  const style = sourceStyle(node, alignments);
  const pipes: RowPipes = { leading: style?.leading ?? true, trailing: style?.trailing ?? true };
  const source = liveSource(node);
  const previousInTable = scratch.inTable;
  scratch.inTable = true;
  scratch.blockLineStart = false;

  // A cell capture rewinds the output buffer, so the separator the previous block left
  // pending has to be on the page first, or it is rewound away with the capture.
  internals(state).flushClose(2);

  // Each line is opened with a newline rather than closed with one: the last row
  // must not leave a trailing newline behind for `closeBlock` to double up.
  node.forEach((row, _offset, rowIndex) => {
    if (rowIndex > 0) state.ensureNewLine();
    const cells = renderCells(state, row);
    // The delimiter row sits between the header and the first body row in the file.
    const raw = source?.[rowIndex === 0 ? 0 : rowIndex + 1];
    if (raw !== undefined && rowMatches(raw, cells)) state.write(raw);
    else writeRow(state, cells, pipes);

    if (rowIndex !== 0) return;
    state.ensureNewLine();
    if (style) {
      state.write(style.row);
      return;
    }
    state.write('|');
    for (const align of alignments) state.write(` ${ALIGN_DELIMITERS[align] ?? '---'} |`);
  });

  scratch.inTable = previousInTable;
  state.closeBlock(node);
}

/**
 * The lines the file wrote, dropped once the table changed width. The delimiter row is
 * always written from the document, and GFM drops a table whose header row and delimiter
 * row disagree on the cell count, so a stale header line would destroy the table.
 */
function liveSource(node: PMNode): string[] | null {
  const raw = rawStringAttr(node.attrs['sourceRows']);
  if (raw === null) return null;
  const rows = raw.split('\n');
  const header = rows[0];
  if (header === undefined) return null;
  return splitRow(header.trim()).length === (node.firstChild?.childCount ?? 0) ? rows : null;
}

/**
 * The cell's own bytes, with nothing the row writes around them. The sentinel keeps
 * `atBlank` false, so `write()` does not open the captured run with the delimiter.
 */
function renderCells(state: SerializerState, row: PMNode): string[] {
  const inner = internals(state);
  const before = inner.out;
  const cells: string[] = [];
  row.forEach((cell) => {
    inner.out = `${before} `;
    renderCell(state, cell);
    cells.push(inner.out.slice(before.length + 1));
  });
  inner.out = before;
  return cells;
}

interface RowPipes {
  leading: boolean;
  trailing: boolean;
}

function writeRow(state: SerializerState, cells: string[], pipes: RowPipes): void {
  const last = cells.length - 1;
  if (pipes.leading) state.write('|');
  cells.forEach((cell, index) => {
    if (pipes.leading || index > 0) state.write(' ');
    state.write(cell);
    if (index < last) {
      state.write(' |');
      return;
    }
    // A one-column row with no pipe at all re-reads as a paragraph, and the table is
    // gone for good: the paragraph form is stable, so no later save can undo it.
    if (pipes.trailing || last === 0) state.write(' |');
  });
}

/**
 * True when the source line still says what the document says. The comparison is on cell
 * text only, so padding, ragged widths and one-sided pipes survive an edit elsewhere in
 * the table, while an edit to this row falls back to a regenerated line.
 */
function rowMatches(raw: string, cells: string[]): boolean {
  const source = splitRow(raw.trim());
  const shared = Math.min(source.length, cells.length);
  for (let index = 0; index < shared; index += 1) {
    if (source[index] !== cells[index]?.trim()) return false;
  }
  // The parser pads a short row out to the header's width. Those cells are not in the file
  // and must not force a rewrite. Extra source cells are ones the parser dropped.
  for (let index = shared; index < cells.length; index += 1) {
    if ((cells[index] ?? '').trim().length > 0) return false;
  }
  return true;
}

/** GFM cell split: a bare `|` ends the cell, an escaped one does not. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\' && index + 1 < line.length) {
      current += char + line[index + 1];
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  if (cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

interface DelimiterStyle {
  row: string;
  leading: boolean;
  trailing: boolean;
  alignments: string[];
}

function headerAlignments(node: PMNode): string[] {
  const header = node.firstChild;
  if (!header) return [];
  const alignments: string[] = [];
  header.forEach((cell) => alignments.push(stringAttr(cell.attrs['align']) ?? ''));
  return alignments;
}

/** The delimiter row the file wrote, dropped once the table no longer has that shape. */
function sourceStyle(node: PMNode, alignments: string[]): DelimiterStyle | null {
  const style = parseDelimiterRow(stringAttr(node.attrs['delims']));
  if (!style) return null;
  if (style.alignments.length !== alignments.length) return null;
  if (style.alignments.some((align, index) => align !== alignments[index])) return null;
  return style;
}

const DELIMITER_CELL = /^:?-+:?$/;

function parseDelimiterRow(row: string | null): DelimiterStyle | null {
  if (row === null) return null;
  // Two independent flags: `| a | b` and `a | b |` are both legal and neither is `| a | b |`.
  const leading = row.startsWith('|');
  const trailing = row.endsWith('|') && row.length > 1;
  const cells = row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  if (cells.some((cell) => !DELIMITER_CELL.test(cell))) return null;
  return { row, leading, trailing, alignments: cells.map(cellAlignment) };
}

function cellAlignment(cell: string): string {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

/** GFM has one line per cell, so block children are joined with explicit breaks. */
function renderCell(state: SerializerState, cell: PMNode): void {
  let written = false;

  // A list or a quote can still reach a cell by paste. Its text belongs to the cell, so the
  // wrapper is flattened rather than dropped with the words inside it.
  const writeBlock = (child: PMNode): void => {
    if (!child.type.inlineContent) {
      child.forEach(writeBlock);
      return;
    }
    if (written) state.write('<br>');
    if (child.content.size > 0) state.renderInline(child, false);
    written = true;
  };

  cell.forEach(writeBlock);
}

// ---------------------------------------------------------------------------
// marks
// ---------------------------------------------------------------------------

function markSerializers(scratch: Scratch): MarkSerializers {
  return {
    bold: {
      open: (_state, mark) => stringAttr(mark.attrs['marker']) ?? '**',
      close: (_state, mark) => stringAttr(mark.attrs['marker']) ?? '**',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    italic: {
      open: (_state, mark) => stringAttr(mark.attrs['marker']) ?? '*',
      close: (_state, mark) => stringAttr(mark.attrs['marker']) ?? '*',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    underline: { open: '<u>', close: '</u>', mixable: true, expelEnclosingWhitespace: true },
    mdEscape: { open: '', close: '', mixable: true },
    // `escape: false` is deliberately absent: it makes prosemirror-markdown write
    // the text itself and skip the `text` serializer, which still has work to do
    // inside a table cell. The text serializer never escapes a code run anyway.
    code: {
      open: (_state, _mark, parent, index) => codeFence(parent, index, true),
      close: (_state, _mark, parent, index) => codeFence(parent, index - 1, false),
    },
    link: {
      open: (_state, mark, parent, index) => {
        scratch.autolink = isBareUrl(mark, parent, index);
        return scratch.autolink ? '<' : '[';
      },
      close: (_state, mark) => {
        const bare = scratch.autolink;
        scratch.autolink = false;
        if (bare) return '>';
        const href = stringAttr(mark.attrs['href']) ?? '';
        return guardPipes(
          `](${formatDestination(href)}${formatTitle(stringAttr(mark.attrs['title']))})`,
          scratch.inTable,
        );
      },
    },
  };
}

/** `<https://example.com>` stays an autolink; every other link keeps its brackets. */
function isBareUrl(mark: Mark, parent: PMNode, index: number): boolean {
  const flag = mark.attrs['autolink'];
  if (flag === false) return false;

  const child = index < parent.childCount ? parent.child(index) : null;
  // An autolink holds one plain text run and no nested syntax. Bolding a source autolink
  // must therefore drop the `<…>` form, or the emphasis lands inside the destination and
  // the link is destroyed. This check comes before the flag for exactly that case.
  if (!child?.isText) return false;
  if (child.marks.length !== 1 || child.marks[0] !== mark) return false;
  if (flag === true) return true;

  const href = stringAttr(mark.attrs['href']);
  if (!href || stringAttr(mark.attrs['title'])) return false;
  if (!/^\w+:/.test(href)) return false;
  if (child.text !== href) return false;
  return index === parent.childCount - 1 || !mark.isInSet(parent.child(index + 1).marks);
}
