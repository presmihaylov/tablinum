import { z } from 'zod';
import { newUlid } from './ids.js';
import { IsoDateSchema } from './schemas.js';
import { UserIdSchema } from './accounts.js';

/**
 * Custom emoji.
 *
 * A workspace can upload its own images and use them wherever a unicode emoji works: in the
 * body of a page, as a page icon and as a space icon. The markdown only ever holds the
 * `:shortcode:` text, so the content repo stays a clean tree of markdown and the image is
 * resolved at render time. The bytes live in `accounts.db` next to the avatars.
 */

/** Prefix of a custom emoji id, in the style of the page and user ids. */
export const CUSTOM_EMOJI_ID_PREFIX = 'ce_';

const CUSTOM_EMOJI_ID_RE = /^ce_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export const isCustomEmojiId = (value: unknown): value is string =>
  typeof value === 'string' && CUSTOM_EMOJI_ID_RE.test(value);

/** Longest shortcode the server accepts, so `:name:` always fits an icon field. */
export const MAX_SHORTCODE_LENGTH = 32;

/** Biggest custom emoji the server stores. An emoji is drawn at one line of text. */
export const MAX_CUSTOM_EMOJI_BYTES = 256 * 1024;

/** Image types a custom emoji may use. Everything else is refused before it is stored. */
export const CUSTOM_EMOJI_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type CustomEmojiMime = (typeof CUSTOM_EMOJI_MIME_TYPES)[number];

const SHORTCODE_RE = /^[a-z0-9_-]+$/;

/** The `:name:` an icon field holds, and the pattern the editor looks for in a line. */
export const SHORTCODE_PATTERN = '[a-z0-9_-]+';

const TOKEN_RE = new RegExp(`^:(${SHORTCODE_PATTERN}):$`);

export const isShortcode = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_SHORTCODE_LENGTH && SHORTCODE_RE.test(value);

export const ShortcodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_SHORTCODE_LENGTH)
  .refine((value) => SHORTCODE_RE.test(value), 'Use lower-case letters, digits, "_" and "-" only');

export const CustomEmojiIdSchema = z
  .string()
  .refine(isCustomEmojiId, 'Expected a custom emoji id like "ce_<ULID>"');

export const CustomEmojiSchema = z.object({
  id: CustomEmojiIdSchema,
  shortcode: z.string(),
  mime: z.string(),
  /** Who uploaded it. Only that person and an admin may delete it. */
  userId: UserIdSchema,
  created: IsoDateSchema,
});

export const CustomEmojiListResponseSchema = z.object({ emoji: z.array(CustomEmojiSchema) });
export const CustomEmojiResponseSchema = z.object({ emoji: CustomEmojiSchema });

export const CustomEmojiParamsSchema = z.object({ shortcode: z.string() });

export type CustomEmoji = z.infer<typeof CustomEmojiSchema>;
export type CustomEmojiListResponse = z.infer<typeof CustomEmojiListResponseSchema>;
export type CustomEmojiResponse = z.infer<typeof CustomEmojiResponseSchema>;

export const newCustomEmojiId = (now?: number): string => CUSTOM_EMOJI_ID_PREFIX + newUlid(now);

/** Where a custom emoji image is served from. The shortcode is the stable, human name. */
export function customEmojiUrl(shortcode: string): string {
  return `/api/v1/emoji/${encodeURIComponent(shortcode)}/image`;
}

/** The shortcode inside an icon value like `:parrot:`, or null when it is a unicode emoji. */
export function shortcodeOf(icon: string | null | undefined): string | null {
  if (typeof icon !== 'string') return null;
  const match = TOKEN_RE.exec(icon);
  const shortcode = match?.[1] ?? null;
  if (shortcode === null || shortcode.length > MAX_SHORTCODE_LENGTH) return null;
  return shortcode;
}

/** The icon value stored in frontmatter for a custom emoji. */
export const shortcodeToken = (shortcode: string): string => `:${shortcode}:`;

/**
 * The real type of an image, read from its first bytes.
 * A browser is free to send any content type it likes, so the declared one is never trusted.
 */
export function sniffImageMime(bytes: Uint8Array): CustomEmojiMime | null {
  const at = (index: number): number => bytes[index] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  const riff = at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46;
  const webp = at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50;
  if (riff && webp) return 'image/webp';
  return null;
}
