import { describe, expect, it } from 'vitest';
import type { Account } from '@tablinum/shared';
import {
  applyMention,
  matchPeople,
  mentionSpot,
  peopleToMention,
} from '../src/components/Comments/mention';
import type { MentionCandidate } from '../src/components/ui/PersonRow';

const PEOPLE: MentionCandidate[] = [
  { id: 'us_1', name: 'Ada Lovelace', handle: 'ada.lovelace', color: '#3b82f6', avatarRev: null },
  { id: 'us_2', name: 'Sam Rivers', handle: 'sam.rivers', color: '#22c55e', avatarRev: null },
  { id: 'us_3', name: 'Grace Adams', handle: 'grace.adams', color: '#f97316', avatarRev: null },
];

describe('mentionSpot', () => {
  it('finds the fragment the caret sits in', () => {
    expect(mentionSpot('tell @ada', 9)).toEqual({ start: 5, query: 'ada' });
  });

  it('opens on the bare @, before a single letter is typed', () => {
    expect(mentionSpot('tell @', 6)).toEqual({ start: 5, query: '' });
  });

  it('reads a mention that opens the body, and one in brackets', () => {
    expect(mentionSpot('@ad', 3)).toEqual({ start: 0, query: 'ad' });
    expect(mentionSpot('(@ad', 4)).toEqual({ start: 1, query: 'ad' });
  });

  // A mention starts a word, or every address in a comment would open the menu.
  it('says nothing about an email address', () => {
    expect(mentionSpot('write to mail@exam', 18)).toBeNull();
  });

  it('says nothing once the fragment is behind the caret', () => {
    expect(mentionSpot('tell @ada now', 13)).toBeNull();
  });

  it('reads the text before the caret, not the whole body', () => {
    expect(mentionSpot('tell @ada about the plan', 9)).toEqual({ start: 5, query: 'ada' });
  });
});

describe('applyMention', () => {
  it('puts the whole handle in and leaves the caret after it', () => {
    const spot = mentionSpot('tell @ada', 9);
    expect(spot).not.toBeNull();
    if (spot === null) return;

    expect(applyMention('tell @ada', spot, 'ada.lovelace')).toEqual({
      text: 'tell @ada.lovelace ',
      caret: 19,
    });
  });

  it('keeps whatever follows the fragment', () => {
    const spot = mentionSpot('tell @ada about it', 9);
    expect(spot).not.toBeNull();
    if (spot === null) return;

    expect(applyMention('tell @ada about it', spot, 'ada.lovelace')).toEqual({
      text: 'tell @ada.lovelace about it',
      caret: 18,
    });
  });
});

describe('matchPeople', () => {
  it('offers everybody in name order for an empty fragment', () => {
    expect(matchPeople(PEOPLE, '').map((one) => one.handle)).toEqual([
      'ada.lovelace',
      'grace.adams',
      'sam.rivers',
    ]);
  });

  it('puts a handle that starts with the fragment above a name that carries it', () => {
    expect(matchPeople(PEOPLE, 'ada').map((one) => one.handle)).toEqual([
      'ada.lovelace',
      'grace.adams',
    ]);
  });

  it('matches the second word of a name', () => {
    expect(matchPeople(PEOPLE, 'rivers').map((one) => one.handle)).toEqual(['sam.rivers']);
  });

  it('offers nobody when nothing matches', () => {
    expect(matchPeople(PEOPLE, 'zzz')).toEqual([]);
  });

  it('never offers more than the limit', () => {
    expect(matchPeople(PEOPLE, '', 2)).toHaveLength(2);
  });
});

describe('peopleToMention', () => {
  const account = (over: Partial<Account>): Account => ({
    id: 'us_00000000000000000000000001',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    handle: 'ada.lovelace',
    role: 'member',
    color: '#3b82f6',
    avatarRev: null,
    disabled: false,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('leaves out somebody who can no longer read the page', () => {
    const rows = peopleToMention([account({}), account({ id: 'us_2', disabled: true })]);
    expect(rows.map((one) => one.id)).toEqual(['us_00000000000000000000000001']);
  });
});
