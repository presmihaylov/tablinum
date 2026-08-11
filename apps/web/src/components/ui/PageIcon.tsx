import { EmojiGlyph } from './EmojiGlyph';
import { DocIcon } from './Icon';

export interface PageIconProps {
  /** The icon of the page. Absent when it carries none. */
  icon?: string;
  /** Side of the blank-page glyph, in pixels. An emoji sizes itself from the text. */
  size?: number;
}

/**
 * The icon of one page: its own emoji, or the blank page everything without one draws.
 * The sidebar, the page tree, the command palette and both page menus all show this,
 * so the fallback is decided in one place.
 */
export function PageIcon({ icon, size = 13 }: PageIconProps) {
  if (icon) return <EmojiGlyph value={icon} />;
  return <DocIcon size={size} />;
}

export default PageIcon;
