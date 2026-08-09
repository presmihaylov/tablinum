import { filterEmoji, type EmojiEntry } from '../../lib/emoji';

export { EMOJI, filterEmoji, type EmojiEntry } from '../../lib/emoji';

/** A colon must open the token, so `10:30` and `https://` never start a query. */
const TRIGGER = /(?:^|\s)(:([^\s:]+):?)$/;

/** How many letters a `:` needs behind it before it counts as a query. */
const MIN_QUERY = 1;
const LIMIT = 12;

export interface EmojiTrigger {
  /** Where the token starts, as an index into the text that was searched. */
  from: number;
  query: string;
}

/** The `:emoji` token the caret sits at the end of, read from the text before it. */
export function findEmojiTrigger(before: string): EmojiTrigger | null {
  const match = TRIGGER.exec(before);
  const token = match?.[1];
  const query = match?.[2];
  if (token === undefined || query === undefined) return null;
  return { from: before.length - token.length, query };
}

/** The emoji a typed `:query` offers. One letter is enough. `:fire:` also works. */
export function matchEmoji(query: string): EmojiEntry[] {
  const needle = query.replace(/:$/, '');
  if (needle.length < MIN_QUERY) return [];
  return filterEmoji(needle).slice(0, LIMIT);
}
