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
  autolink: boolean;
  forced: WeakSet<PMNode>;
}

export function serializeDoc(doc: PMNode): string {
  const scratch: Scratch = {
    inTable: false,
    blockLineStart: true,
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

function dropTightMarks(text: string): string {
  return text.split(`\n\n${TIGHT_MARK}`).join('\n').split(TIGHT_MARK).join('');
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

function writeGap(
  state: SerializerState,
  node: PMNode,
  parent: PMNode,
  index: number,
): void {
  if (index === 0 || parent.type.name !== 'doc') return;
  const gap = numberAttr(node.attrs['gap']);
  if (gap === null) return;
  if (gap > 1) {
    state.text('\n'.repeat(gap - 1), false);
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
  return name === 'htmlBlock' && isComment(node);
}

/** This block opens with a marker strong enough to break the block above. */
function interrupts(node: PMNode): boolean {
  const name = node.type.name;
  if (name === 'heading') return setextRun(node) === null;
  if (name === 'horizontalRule') return true;
  // An indented code block reads as a continuation line, a fenced one does not.
  if (name === 'codeBlock') return rawStringAttr(node.attrs['fence']) !== '';
  return name === 'htmlBlock' && isComment(node);
}

function isComment(node: PMNode): boolean {
  return (rawStringAttr(node.attrs['raw']) ?? '').startsWith('<!--');
}

function nodeSerializers(scratch: Scratch): NodeSerializers {
  return {
    text: (state, node, parent, index) => serializeText(scratch, state, node, parent, index),

    paragraph: (state, node) => {
      scratch.blockLineStart = true;
      state.renderInline(node);
      const trail = stringAttr(node.attrs['trail']);
      if (trail !== null) state.text(trail, false);
      state.closeBlock(node);
    },

    heading: (state, node) => serializeHeading(scratch, state, node),

    blockquote: (state, node) => {
      guardLeadingText(scratch, node, looksLikeAlert);
      state.wrapBlock('> ', null, node, () => state.renderContent(node));
    },

    callout: (state, node) => {
      state.wrapBlock('> ', null, node, () => {
        state.write(`[!${calloutKeyword(node)}]`);
        // An empty callout is one line. Opening a second one would leave a newline the
        // serializer never closes, and the document would grow by a byte on every save.
        if (isEmptyCallout(node)) return;
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
      state.write(`![${label}](${formatDestination(src)}${formatTitle(title)})`);
    },

    bulletList: (state, node) => {
      const marker = stringAttr(node.attrs['marker']) ?? '-';
      state.renderList(node, '  ', () => `${marker} `);
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
      state.renderList(node, '  ', () => `${marker} `);
    },

    taskItem: (state, node) => {
      // `- [ ]` with no label carries no space after the box; adding one is a trailing run
      // that most linters flag.
      state.write(node.textContent.length === 0 ? `[${checkbox(node)}]` : `[${checkbox(node)}] `);
      state.renderContent(node);
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
      state.text(rawStringAttr(node.attrs['raw']) ?? '', false);
    },

    wikilink: (state, node) => {
      const target = stringAttr(node.attrs['target']) ?? '';
      const alias = rawStringAttr(node.attrs['alias']);
      state.write(alias === null ? `[[${target}]]` : `[[${target}|${alias}]]`);
    },
  };
}

/** The keyword as the file wrote it, unless the block has since been re-typed in the editor. */
function calloutKeyword(node: PMNode): string {
  const type = toCalloutType(node.attrs['type']);
  const label = stringAttr(node.attrs['label']);
  return label !== null && label.toUpperCase() === type ? label : type;
}

/** A callout that holds nothing but the empty paragraph the schema requires. */
function isEmptyCallout(node: PMNode): boolean {
  if (node.childCount !== 1) return false;
  const only = node.firstChild;
  return only?.type.name === 'paragraph' && only.content.size === 0;
}

const ALERT_LINE = /^\[!([A-Za-z]+)\][ \t]*$/;
const CHECKBOX_LINE = /^\[[ xX]\](\s|$)/;

function looksLikeAlert(text: string): boolean {
  const kind = ALERT_LINE.exec(text)?.[1];
  return kind !== undefined && isCalloutType(kind.toUpperCase());
}

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
  matches: (text: string) => boolean,
): void {
  const paragraph = block.firstChild;
  if (paragraph?.type.name !== 'paragraph') return;
  const first = paragraph.firstChild;
  if (!first?.isText || !matches(first.text ?? '')) return;
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
    const lineStart = first ? afterBreak || (previous === null && scratch.blockLineStart) : true;
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
    const indented = text
      .split('\n')
      .map((line) => (line.length === 0 ? '' : `    ${line}`))
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
    state.ensureNewLine();
  }
  state.write(bar);
  state.closeBlock(node);
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

function serializeOrderedList(state: SerializerState, node: PMNode): void {
  const start = numberAttr(node.attrs['start']) ?? 1;
  const delimiter = stringAttr(node.attrs['delimiter']) === ')' ? ')' : '.';
  const width = String(start + node.childCount - 1).length;

  // Markers are written flush left. A file almost never pads `9.` to line up with
  // `10.`, so aligning them here would rewrite the list the moment it is opened.
  state.renderList(node, state.repeat(' ', width + 2), (index) => `${start + index}${delimiter} `);
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
  const outerPipes = style?.outerPipes ?? true;
  const previousInTable = scratch.inTable;
  scratch.inTable = true;
  scratch.blockLineStart = false;

  // Each line is opened with a newline rather than closed with one: the last row
  // must not leave a trailing newline behind for `closeBlock` to double up.
  node.forEach((row, _offset, rowIndex) => {
    if (rowIndex > 0) state.ensureNewLine();
    if (outerPipes) state.write('|');
    const last = row.childCount - 1;
    row.forEach((cell, _cellOffset, cellIndex) => {
      if (outerPipes || cellIndex > 0) state.write(' ');
      renderCell(state, cell);
      if (outerPipes || cellIndex < last) state.write(' |');
    });

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

interface DelimiterStyle {
  row: string;
  outerPipes: boolean;
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
  const outerPipes = row.startsWith('|') && row.endsWith('|') && row.length > 1;
  const cells = row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  if (cells.some((cell) => !DELIMITER_CELL.test(cell))) return null;
  return { row, outerPipes, alignments: cells.map(cellAlignment) };
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
  cell.forEach((child) => {
    if (!child.type.inlineContent) return;
    if (written) state.write('<br>');
    if (child.content.size > 0) state.renderInline(child, false);
    written = true;
  });
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
        return `](${formatDestination(href)}${formatTitle(stringAttr(mark.attrs['title']))})`;
      },
    },
  };
}

/** `<https://example.com>` stays an autolink; every other link keeps its brackets. */
function isBareUrl(mark: Mark, parent: PMNode, index: number): boolean {
  const flag = mark.attrs['autolink'];
  if (flag === true) return true;
  if (flag === false) return false;

  const href = stringAttr(mark.attrs['href']);
  if (!href || stringAttr(mark.attrs['title'])) return false;
  if (!/^\w+:/.test(href)) return false;

  const child = index < parent.childCount ? parent.child(index) : null;
  if (!child?.isText || child.text !== href) return false;
  // An autolink cannot hold nested syntax, so the link must be the innermost mark.
  if (child.marks[child.marks.length - 1] !== mark) return false;
  return index === parent.childCount - 1 || !mark.isInSet(parent.child(index + 1).marks);
}
