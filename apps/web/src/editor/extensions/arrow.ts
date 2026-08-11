import { Extension } from '@tiptap/core';
import { rightArrow } from '@tiptap/extension-typography';
import { ARROW } from '../../lib/arrow';

/**
 * `->` becomes `→`, from Typography's own tested rule.
 *
 * Only that one rule. The rest of the bundle rewrites quotes, dashes, ellipses and fractions,
 * and each of those would churn characters the author typed and break the byte-identical round
 * trip. `->` costs nothing on the way back out, because it is not markdown syntax.
 *
 * Tiptap's input rule runner already refuses to fire inside a node whose spec says `code`, and
 * beside a mark that says the same, so code blocks, mermaid blocks and code spans are covered.
 */
export const ArrowRule = Extension.create({
  name: 'tablinumArrowRule',

  addInputRules() {
    return [rightArrow(ARROW)];
  },
});
