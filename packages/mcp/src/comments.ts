import {
  ANCHOR_CONTEXT_LENGTH,
  MAX_QUOTE_LENGTH,
  findAll,
  markdownToPlainText,
  validation,
  type CommentAnchor,
} from '@tablinum/shared';

/**
 * Where a comment thread hangs.
 *
 * A thread does not hold a position: it quotes the words it is about, and the browser looks that
 * quote up again on every load. So the anchor is built from the prose a reader sees rather than
 * from the markup: a quote of "# Release" would find nothing, and a quote of "Release" lands on
 * the heading. The same rule holds for a link, a bold word and a code span.
 */
export function anchorFor(markdown: string, quote: string, occurrence?: number): CommentAnchor {
  const text = markdownToPlainText(markdown);
  const wanted = quote.trim();
  if (wanted.length === 0) throw validation('Quote the words the comment is about.');
  if (wanted.length > MAX_QUOTE_LENGTH) {
    throw validation(
      `A thread quotes at most ${MAX_QUOTE_LENGTH} characters. Quote the opening sentence instead.`,
    );
  }

  const found = findAll(text, wanted);
  if (found.length === 0) {
    throw validation(
      `The page does not say ${JSON.stringify(wanted)}. Quote it as a reader sees it, ` +
        'without the markdown around it.',
    );
  }

  const which = occurrence ?? 1;
  if (which > found.length) {
    throw validation(
      `The page says ${JSON.stringify(wanted)} ${found.length} time(s), so there is no ` +
        `occurrence ${which}.`,
    );
  }

  const start = found[which - 1] ?? 0;
  const after = start + wanted.length;
  return {
    quote: wanted,
    prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
    suffix: text.slice(after, after + ANCHOR_CONTEXT_LENGTH),
    start,
  };
}
