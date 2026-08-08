import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { CALLOUT_TYPES, DATA, toCalloutType } from '../markdown';
import type { CalloutType } from '../markdown';

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (type: CalloutType) => ReturnType;
      toggleCallout: (type: CalloutType) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

/**
 * `> ` has already become a blockquote by the time the alert marker is typed, so
 * the rule matches the marker alone and re-types the quote around it.
 */
const INPUT_RULE = new RegExp(`^\\[!(${CALLOUT_TYPES.join('|')})\\]\\s$`, 'i');

/** A GitHub alert blockquote, shown as a coloured block. */
export const Callout = Node.create<CalloutOptions>({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      type: {
        default: 'NOTE',
        keepOnSplit: true,
        parseHTML: (element: HTMLElement) => toCalloutType(element.getAttribute(DATA.callout)),
        renderHTML: (attributes: Record<string, unknown>) => ({
          [DATA.callout]: toCalloutType(attributes['type']),
        }),
      },
      // The keyword exactly as the file wrote it, so `[!note]` is not upper-cased on save.
      label: {
        default: null,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => element.getAttribute(DATA.marker),
        renderHTML: (attributes: Record<string, unknown>) => {
          const label = attributes['label'];
          if (typeof label !== 'string' || label.length === 0) return {};
          return { [DATA.marker]: label };
        },
      },
    };
  },

  parseHTML() {
    // Beats the plain blockquote rule, which would otherwise claim the element.
    return [{ tag: `blockquote[${DATA.callout}]`, priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'blockquote',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'gd-editor-callout',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (type) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { type }),
      toggleCallout:
        (type) =>
        ({ commands, editor }) => {
          if (editor.isActive(this.name, { type })) return commands.lift(this.name);
          if (editor.isActive(this.name)) return commands.updateAttributes(this.name, { type });
          return commands.wrapIn(this.name, { type });
        },
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },

  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: INPUT_RULE,
        handler: ({ state, range, match, chain }) => {
          const start = state.doc.resolve(range.from);
          const depth = start.depth - 1;
          if (depth < 1 || start.node(depth).type.name !== 'blockquote') return null;

          const quotePos = start.before(depth);
          const kind = toCalloutType(match[1]?.toUpperCase());
          chain()
            .command(({ tr }) => {
              // The quote starts before the deleted range, so its position holds.
              tr.delete(range.from, range.to);
              tr.setNodeMarkup(quotePos, type, { type: kind });
              return true;
            })
            .run();
          return undefined;
        },
      }),
    ];
  },
});

export default Callout;
