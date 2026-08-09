import { useSyncExternalStore } from 'react';
import { customEmojiUrl, shortcodeToken, type CustomEmoji } from '@tablinum/shared';
import type { EmojiEntry } from './emoji';

/**
 * Every custom emoji this install knows about.
 *
 * It is a module-level registry rather than React state because the markdown parser, the
 * serializer and the editor's input rules are plain functions: they run outside the tree and
 * still have to decide whether `:parrot:` is an emoji or just a colon in a sentence.
 */
let entries: readonly EmojiEntry[] = [];
let byShortcode = new Map<string, EmojiEntry>();
const listeners = new Set<() => void>();

const toEntry = (emoji: CustomEmoji): EmojiEntry => ({
  char: shortcodeToken(emoji.shortcode),
  name: emoji.shortcode,
  keywords: [],
  src: customEmojiUrl(emoji.shortcode),
});

/** Replace the set. Called when the list lands and after every upload or delete. */
export function setCustomEmoji(list: readonly CustomEmoji[]): void {
  entries = list.map(toEntry);
  byShortcode = new Map(entries.map((entry) => [entry.name, entry]));
  for (const listener of listeners) listener();
}

export function customEmojiEntries(): readonly EmojiEntry[] {
  return entries;
}

/** True once somebody has uploaded this name. The parser only claims names it knows. */
export function isCustomEmoji(shortcode: string): boolean {
  return byShortcode.has(shortcode);
}

/**
 * Best match first: the whole name, then its start, then anywhere inside it.
 * `from` lets a component pass the set it is already subscribed to.
 */
export function filterCustomEmoji(
  query: string,
  from: readonly EmojiEntry[] = entries,
): EmojiEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...from];
  return from
    .filter((entry) => entry.name.includes(needle))
    .sort((a, b) => rank(a.name, needle) - rank(b.name, needle));
}

function rank(name: string, needle: string): number {
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  return 2;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The set, for a component that must redraw when somebody uploads or deletes one. */
export function useCustomEmojiEntries(): readonly EmojiEntry[] {
  return useSyncExternalStore(subscribe, customEmojiEntries, customEmojiEntries);
}
