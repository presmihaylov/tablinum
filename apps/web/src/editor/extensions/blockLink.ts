import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** The class the block a link opened carries. The stylesheet fades it out on its own. */
export const LINKED_CLASS = 'gd-block-linked';

export const blockLinkKey = new PluginKey<DecorationSet>('gdBlockLink');

interface FlashRange {
  from: number;
  to: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockLink: {
      /** Light the block over this range, or take the light away with null. */
      flashBlock: (range: FlashRange | null) => ReturnType;
    };
  }
}

/**
 * The mark a block link leaves when it opens a page. It is a decoration and not a mark, so it
 * cannot reach the markdown file, and it rides along with the text while somebody types.
 */
export const BlockLink = Extension.create({
  name: 'blockLink',

  addCommands() {
    return {
      flashBlock:
        (range) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(blockLinkKey, range));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: blockLinkKey,
        state: {
          init: (): DecorationSet => DecorationSet.empty,
          apply(tr, value): DecorationSet {
            const range: FlashRange | null | undefined = tr.getMeta(blockLinkKey);
            if (range === null) return DecorationSet.empty;
            if (range !== undefined) {
              const size = tr.doc.content.size;
              if (range.from < 0 || range.to > size || range.to <= range.from) {
                return DecorationSet.empty;
              }
              return DecorationSet.create(tr.doc, [
                Decoration.node(range.from, range.to, { class: LINKED_CLASS }),
              ]);
            }
            if (!tr.docChanged) return value;
            return value.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state): DecorationSet | undefined {
            return blockLinkKey.getState(state);
          },
        },
      }),
    ];
  },
});

export default BlockLink;
