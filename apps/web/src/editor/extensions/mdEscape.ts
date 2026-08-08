import { Mark, mergeAttributes } from '@tiptap/core';
import { DATA } from '../markdown';

/**
 * Marks a character that the source file wrote as a backslash escape. The mark
 * has no visual effect; it exists so `\*` is written back as `\*` instead of the
 * bare `*` the parser produced. It is not inclusive, so typing next to an escaped
 * character produces ordinary text.
 */
export const MdEscape = Mark.create({
  name: 'mdEscape',
  inclusive: false,
  spanning: true,

  parseHTML() {
    return [{ tag: `span[${DATA.escape}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { [DATA.escape]: '' }), 0];
  },
});

export default MdEscape;
