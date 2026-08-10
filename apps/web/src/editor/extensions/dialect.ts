import { Extension } from '@tiptap/core';
import type { Attribute } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';
import { configureMarkdownIt, DATA, decodeRaw, encodeRaw } from '../markdown';

/**
 * Carries markdown source detail onto the ProseMirror schema. Everything the
 * serializer needs to rebuild the original bytes - fence widths, list markers,
 * emphasis delimiters, break style - is declared here as a node or mark
 * attribute, so no extension has to be forked just to hold one value.
 *
 * The low priority matters: attributes declared last win, which lets the list
 * `tight` attribute below replace the looser one from `tiptap-markdown`.
 */
export const MarkdownDialect = Extension.create({
  name: 'tablinumMarkdownDialect',
  priority: 10,

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: MarkdownIt) {
            configureMarkdownIt(markdownit);
          },
        },
      },
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          setext: sourceAttr('setext', DATA.setext),
          trail: encodedAttr('trail', DATA.trail, null),
        },
      },
      {
        types: ['bulletList'],
        attributes: { marker: sourceAttr('marker', DATA.marker, '-'), tight: tightAttr(false) },
      },
      {
        types: ['orderedList'],
        attributes: {
          delimiter: sourceAttr('delimiter', DATA.delimiter, '.'),
          tight: tightAttr(false),
          sourceNumbers: numberSequenceAttr(),
        },
      },
      {
        types: ['taskList'],
        attributes: {
          marker: sourceAttr('marker', DATA.marker, '-'),
          delimiter: sourceAttr('delimiter', DATA.delimiter, '.'),
          tight: tightAttr(true),
          sourceNumbers: numberSequenceAttr(),
        },
      },
      // `number` is the item's own source number. `keepOnSplit: false` is load bearing:
      // a number that survived a split would renumber the list after every edit.
      { types: ['listItem'], attributes: { number: sourceAttr('number', DATA.number) } },
      {
        types: ['taskItem'],
        attributes: {
          marker: sourceAttr('marker', DATA.marker),
          number: sourceAttr('number', DATA.number),
        },
      },
      {
        types: ['horizontalRule'],
        attributes: { markup: sourceAttr('markup', DATA.markup, '---') },
      },
      { types: ['hardBreak'], attributes: { marker: encodedAttr('marker', DATA.break, '\\\n') } },
      { types: ['paragraph'], attributes: { trail: encodedAttr('trail', DATA.trail, null) } },
      // The raw `![label]` source. An image the user inserts has no label and falls back to alt.
      { types: ['image'], attributes: { label: encodedAttr('label', DATA.label, null) } },
      {
        types: ['codeBlock'],
        attributes: {
          fence: sourceAttr('fence', DATA.fence),
          info: sourceAttr('info', DATA.info),
          // Whitespace only, so it travels encoded rather than raw.
          indent: encodedAttr('indent', DATA.indent, null),
        },
      },
      { types: ['bold'], attributes: { marker: sourceAttr('marker', DATA.marker, '**') } },
      { types: ['italic'], attributes: { marker: sourceAttr('marker', DATA.marker, '*') } },
      { types: ['link'], attributes: { autolink: autolinkAttr(), title: titleAttr() } },
      {
        types: ['table'],
        attributes: {
          delims: sourceAttr('delims', DATA.delims),
          // The whole table, line by line, so it holds newlines.
          sourceRows: encodedAttr('sourceRows', DATA.rows, null),
        },
      },
      { types: ['tableHeader', 'tableCell'], attributes: { align: alignAttr() } },
      { types: GAP_TYPES, attributes: { gap: gapAttr() } },
    ];
  },
});

/**
 * Every block whose blank-line run is countable: the top-level blocks, plus the list items
 * that carry the run between two items of the same list.
 */
const GAP_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'callout',
  'codeBlock',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'taskList',
  'table',
  'htmlBlock',
  'pageEmbed',
  'diagram',
  'listItem',
  'taskItem',
];

/** A verbatim slice of the source, parked on a data attribute. */
function sourceAttr(name: string, domName: string, fallback: string | null = null): Attribute {
  return {
    default: fallback,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => element.getAttribute(domName),
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[name];
      if (typeof value !== 'string') return {};
      return { [domName]: value };
    },
  };
}

/** Same as `sourceAttr`, for values that hold newlines a DOM attribute would mangle. */
function encodedAttr(name: string, domName: string, fallback: string | null): Attribute {
  return {
    default: fallback,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute(domName);
      return raw === null ? null : decodeRaw(raw);
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[name];
      if (typeof value !== 'string') return {};
      return { [domName]: encodeRaw(value) };
    },
  };
}

/**
 * The file's own item numbers, in order. An item number is only safe to write back while
 * this record still lines up with the list item for item, so it is never rendered: it is
 * read afresh from whatever items the DOM holds.
 */
function numberSequenceAttr(): Attribute {
  return {
    default: null,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => {
      const items = Array.from(element.querySelectorAll(':scope > li'));
      if (items.length === 0) return null;
      return items.map((item) => item.getAttribute(DATA.number) ?? '').join(' ');
    },
    renderHTML: () => ({}),
  };
}

/**
 * A list is tight when its own items hold bare text. `tiptap-markdown` looks for
 * any descendant paragraph, which wrongly loosens a tight list that contains a
 * quote or a loose sublist. The parser states it outright; the probe is the
 * fallback for DOM that did not come from the parser, such as a paste.
 */
function tightAttr(render: boolean): Attribute {
  return {
    default: true,
    keepOnSplit: true,
    parseHTML: (element: HTMLElement) => {
      const stated = element.getAttribute('data-tight');
      if (stated === 'true' || stated === 'false') return stated === 'true';
      return element.querySelector(':scope > li > p') === null;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      if (!render) return {};
      return attributes['tight'] === true ? { 'data-tight': 'true', class: 'tight' } : {};
    },
  };
}

function autolinkAttr(): Attribute {
  return {
    default: null,
    keepOnSplit: false,
    // `null` means "the source did not say"; only then may the serializer guess.
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute(DATA.autolink);
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return null;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      if (attributes['autolink'] === true) return { [DATA.autolink]: 'true' };
      if (attributes['autolink'] === false) return { [DATA.autolink]: 'false' };
      return {};
    },
  };
}

/** The `Link` extension declares no title, so a `[a](b "c")` title would be dropped. */
function titleAttr(): Attribute {
  return {
    default: null,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => element.getAttribute('title'),
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes['title'];
      if (typeof value !== 'string') return {};
      return { title: value };
    },
  };
}

/** How many blank lines preceded the block. One is the default and is not stored. */
function gapAttr(): Attribute {
  return {
    default: null,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute(DATA.gap);
      if (raw === null) return null;
      const value = Number.parseInt(raw, 10);
      return Number.isFinite(value) ? value : null;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes['gap'];
      if (typeof value !== 'number') return {};
      return { [DATA.gap]: String(value) };
    },
  };
}

const ALIGNMENTS = ['left', 'center', 'right'];

function alignAttr(): Attribute {
  return {
    default: null,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => {
      const inline = element.style.textAlign;
      if (ALIGNMENTS.includes(inline)) return inline;
      return element.getAttribute(DATA.align);
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes['align'];
      if (typeof value !== 'string' || !ALIGNMENTS.includes(value)) return {};
      return { [DATA.align]: value, style: `text-align: ${value}` };
    },
  };
}
