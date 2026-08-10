import { describe, expect, it } from 'vitest';
import {
  CARD_GAP,
  fieldHeight,
  groupByAnchor,
  stackGroups,
  type StackItem,
} from '../src/components/Comments/layout';

/**
 * The placement of the thread cards. Every card starts level with the words it marks, threads
 * about one spot are read together, and no two cards ever overlap.
 */

function item(key: string, desired: number, height: number): StackItem {
  return { key, desired, height };
}

/** Every card, top to bottom, with the room each one takes. */
function boxes(items: StackItem[], priority: string | null = null) {
  const placed = stackGroups(items, priority);
  const heights = new Map(items.map((one) => [one.key, one.height]));
  return placed.map((one) => ({ ...one, bottom: one.top + (heights.get(one.key) ?? 0) }));
}

function overlaps(placed: ReturnType<typeof boxes>): boolean {
  return placed.some((one, index) => index > 0 && one.top < (placed[index - 1]?.bottom ?? 0));
}

describe('grouping the cards', () => {
  it('reads two threads on the same line as one group', () => {
    const groups = groupByAnchor([
      { id: 'a', desired: 100 },
      { id: 'b', desired: 108 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.ids).toEqual(['a', 'b']);
    expect(groups[0]?.desired).toBe(100);
  });

  it('keeps two threads far apart in groups of their own', () => {
    const groups = groupByAnchor([
      { id: 'a', desired: 100 },
      { id: 'b', desired: 400 },
    ]);

    expect(groups.map((group) => group.ids)).toEqual([['a'], ['b']]);
  });

  it('puts the groups in the order the words are on the page', () => {
    const groups = groupByAnchor([
      { id: 'late', desired: 900 },
      { id: 'early', desired: 20 },
    ]);

    expect(groups.map((group) => group.ids[0])).toEqual(['early', 'late']);
  });

  it('measures every member against the head, so a long run cannot drift', () => {
    const groups = groupByAnchor([
      { id: 'a', desired: 0 },
      { id: 'b', desired: 20 },
      { id: 'c', desired: 40 },
    ]);

    // c is 20 from b but 40 from the head, which is another spot on the page.
    expect(groups.map((group) => group.ids)).toEqual([['a', 'b'], ['c']]);
  });
});

describe('placing the groups', () => {
  it('leaves a card where its words are when there is room', () => {
    expect(boxes([item('a', 100, 60), item('b', 400, 60)]).map((one) => one.top)).toEqual([100, 400]);
  });

  it('pushes a card down rather than let it cover the one above', () => {
    const placed = boxes([item('a', 100, 60), item('b', 120, 60)]);

    expect(placed.map((one) => one.top)).toEqual([100, 100 + 60 + CARD_GAP]);
    expect(overlaps(placed)).toBe(false);
  });

  it('never puts a card above the top of the field', () => {
    expect(boxes([item('a', -50, 60)]).map((one) => one.top)).toEqual([0]);
  });

  it('holds the card in focus at its words and moves the others away', () => {
    const placed = boxes([item('a', 300, 60), item('b', 320, 60), item('c', 340, 60)], 'b');

    expect(placed.map((one) => one.key)).toEqual(['a', 'b', 'c']);
    // b is where its words are; a is pulled up above it and c is pushed down below it.
    expect(placed[1]?.top).toBe(320);
    expect(placed[0]?.top).toBe(320 - CARD_GAP - 60);
    expect(placed[2]?.top).toBe(320 + 60 + CARD_GAP);
    expect(overlaps(placed)).toBe(false);
  });

  it('gives up the place of the card in focus when there is no room above it', () => {
    const placed = boxes([item('a', 0, 60), item('b', 10, 60)], 'b');

    // a cannot go above the field, so b takes what is left rather than cover it.
    expect(placed.map((one) => one.top)).toEqual([0, 60 + CARD_GAP]);
    expect(overlaps(placed)).toBe(false);
  });

  it('settles a whole column of cards that all want the same spot', () => {
    const many = Array.from({ length: 6 }, (_, index) => item(`t${index}`, 200, 50));
    const placed = boxes(many);

    expect(overlaps(placed)).toBe(false);
    expect(placed[0]?.top).toBe(200);
    expect(placed[5]?.top).toBe(200 + 5 * (50 + CARD_GAP));
  });

  it('answers nothing for an empty field', () => {
    expect(stackGroups([], null)).toEqual([]);
    expect(fieldHeight([], [])).toBe(0);
  });

  it('is as tall as the last card reaches', () => {
    const items = [item('a', 100, 60), item('b', 400, 90)];
    expect(fieldHeight(items, stackGroups(items, null))).toBe(490);
  });
});
