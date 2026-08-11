import type { HandlePreviewResponse } from '@tablinum/shared';

/**
 * What a handle change costs, in words.
 *
 * A person renaming themselves and an admin renaming somebody else read the same sentences from
 * here. The admin route rewrites text belonging to people who are not in the room, so it must
 * not be told less than the person who owns the handle is told.
 */

/** How a sentence names whoever holds the handle. */
export interface Holder {
  /** Object form: "you", or "Ada Lovelace". */
  name: string;
  /** Possessive form: "your", or "Ada Lovelace's". */
  possessive: string;
  /** Object pronoun for a second reference in the same sentence: "you", or "them". */
  pronoun: string;
}

/** The reader renaming themselves. */
export const YOURSELF: Holder = { name: 'you', possessive: 'your', pronoun: 'you' };

/** Somebody else, for an admin acting on their behalf. */
export function holderNamed(name: string): Holder {
  return { name, possessive: `${name}'s`, pronoun: 'them' };
}

function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** What a change would do to the text that already names this person. */
export function describeRewrite(
  preview: HandlePreviewResponse | undefined,
  holder: Holder,
): string {
  if (preview === undefined) {
    return `A change rewrites every mention of ${holder.possessive} old handle.`;
  }
  if (preview.pages === 0 && preview.comments === 0) {
    return `Nothing mentions ${holder.possessive} handle yet, so a change rewrites nothing.`;
  }
  const parts = counted(preview.pages, 'page');
  const rest = counted(preview.comments, 'comment');
  return `A change rewrites ${parts} and ${rest} in one commit.`;
}

/**
 * That the old handle is not released. It is the same promise either way: the sweep can miss a
 * page, and the reservation is what keeps that page naming the right person until somebody
 * comes back to it.
 */
export function describeReservation(handle: string, holder: Holder): string {
  return `@${handle} stays reserved for ${holder.name}, so nobody else can take it and an old copy of a page still points at ${holder.pronoun}.`;
}
