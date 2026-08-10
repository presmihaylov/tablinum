import type { Account } from '@tablinum/shared';
import type { AvatarPerson } from '../Account/Avatar';

/**
 * Naming somebody in a comment.
 *
 * A comment carries the same plain `@handle` text a page does, so one body reads the same
 * everywhere and the server finds the mentions with the rule it already has. This file only
 * works out what is being typed and what to put in its place; the menu itself is the composer.
 */

/** A person the menu can offer. */
export interface MentionPerson extends AvatarPerson {
  handle: string;
}

/** Where the fragment being typed starts, and what has been typed of it so far. */
export interface MentionSpot {
  /** Index of the `@`. */
  start: number;
  query: string;
}

/**
 * A mention starts a word, so `mail@example.com` names nobody. The fragment is looser than a
 * handle: `ada.` is halfway to one, and an empty fragment opens the menu on everybody.
 */
const TYPING_RE = /(?:^|[\s([{<"'*_~])@([a-z0-9._-]{0,32})$/i;

/** What the caret sits in the middle of, or null when it is not in a mention. */
export function mentionSpot(text: string, caret: number): MentionSpot | null {
  const match = TYPING_RE.exec(text.slice(0, caret));
  if (match === null) return null;
  const query = match[1] ?? '';
  return { start: caret - query.length - 1, query };
}

/** The body with the whole handle in place of the fragment, and where the caret goes next. */
export function applyMention(
  text: string,
  spot: MentionSpot,
  handle: string,
): { text: string; caret: number } {
  const rest = text.slice(spot.start + 1 + spot.query.length);
  // One space after the handle, and only when the writer has not already left one there.
  const gap = rest.startsWith(' ') ? '' : ' ';
  const head = `${text.slice(0, spot.start)}@${handle}${gap}`;
  return { text: head + rest, caret: head.length };
}

/** The people the fragment could mean, best first. Everybody, in name order, for an empty one. */
export function matchPeople(
  people: readonly MentionPerson[],
  query: string,
  limit = 6,
): MentionPerson[] {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const wanted = query.trim().toLowerCase();
  if (wanted.length === 0) return sorted.slice(0, limit);

  const scored: { person: MentionPerson; rank: number }[] = [];
  for (const person of sorted) {
    const rank = rankOf(person, wanted);
    if (rank !== null) scored.push({ person, rank });
  }
  scored.sort((a, b) => a.rank - b.rank);
  return scored.slice(0, limit).map((one) => one.person);
}

/** Lower is better. Null when the person does not match at all. */
function rankOf(person: MentionPerson, wanted: string): number | null {
  const handle = person.handle.toLowerCase();
  const name = person.name.toLowerCase();
  if (handle.startsWith(wanted)) return 0;
  if (name.split(/\s+/).some((word) => word.startsWith(wanted))) return 1;
  if (handle.includes(wanted) || name.includes(wanted)) return 2;
  return null;
}

/** The roster of the workspace, as the menu wants it. Somebody disabled is left out. */
export function peopleToMention(users: readonly Account[]): MentionPerson[] {
  return users
    .filter((user) => !user.disabled)
    .map((user) => ({
      id: user.id,
      name: user.name,
      handle: user.handle,
      color: user.color,
      avatarRev: user.avatarRev,
    }));
}
