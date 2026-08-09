import { customEmojiUrl, shortcodeOf } from '@tablinum/shared';

export interface EmojiGlyphProps {
  /** A unicode emoji, or `:shortcode:` naming a custom one. */
  value: string;
  /** An extra class for a caller that sizes the image itself. */
  className?: string;
}

/**
 * One icon value, drawn.
 *
 * A unicode emoji is text and a custom one is a picture, so every place that shows an icon
 * goes through here rather than printing the value. A shortcode nobody uploaded falls back to
 * the alt text, which is the shortcode itself.
 */
export function EmojiGlyph({ value, className }: EmojiGlyphProps) {
  const shortcode = shortcodeOf(value);
  if (shortcode === null) return <>{value}</>;
  return (
    <img
      className={`emoji-glyph${className ? ` ${className}` : ''}`}
      src={customEmojiUrl(shortcode)}
      alt={value}
      draggable={false}
    />
  );
}

export default EmojiGlyph;
