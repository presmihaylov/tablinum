/**
 * Where the thread cards sit beside the text they mark.
 *
 * Two rules answer for the whole layout: a card starts level with its own words, and no two
 * cards ever overlap. Threads written about the same spot are read as one group, and when
 * there is not enough room the cards move away from the one the reader is in.
 */

/** Cards whose words sit this close together mark the same spot, so they share a group. */
export const CLUSTER_PX = 24;

/** The room between two groups. */
export const CARD_GAP = 8;

export interface AnchoredCard {
  id: string;
  /** Where the words this card marks start, measured from the top of the field. */
  desired: number;
}

export interface CardGroup {
  /** The threads of the group, top to bottom. The first id names the group. */
  ids: string[];
  desired: number;
}

export function groupByAnchor(cards: AnchoredCard[], clusterPx = CLUSTER_PX): CardGroup[] {
  const sorted = [...cards].sort((a, b) => a.desired - b.desired);
  const groups: CardGroup[] = [];

  for (const card of sorted) {
    const last = groups[groups.length - 1];
    // Measured against the head of the group, so a long run of near neighbours cannot drift.
    if (last !== undefined && card.desired - last.desired <= clusterPx) {
      last.ids.push(card.id);
      continue;
    }
    groups.push({ ids: [card.id], desired: card.desired });
  }

  return groups;
}

export interface StackItem {
  key: string;
  desired: number;
  height: number;
}

export interface Placement {
  key: string;
  top: number;
}

/**
 * Place every group at its words, then take the overlaps out. The group in focus keeps its
 * place and pushes its neighbours away on both sides; without one, everything settles downwards.
 */
export function stackGroups(
  items: StackItem[],
  priorityKey: string | null,
  gap = CARD_GAP,
): Placement[] {
  const sorted = [...items].sort((a, b) => a.desired - b.desired);
  if (sorted.length === 0) return [];
  const tops = sorted.map((item) => Math.max(0, item.desired));
  const pivot = priorityKey === null ? -1 : sorted.findIndex((item) => item.key === priorityKey);

  const at = (index: number): number => tops[index] ?? 0;
  const want = (index: number): number => sorted[index]?.desired ?? 0;
  const height = (index: number): number => sorted[index]?.height ?? 0;

  // Above the card in focus, each card is pulled up until it just clears the one below it.
  for (let i = pivot - 1; i >= 0; i -= 1) tops[i] = Math.min(want(i), at(i + 1) - gap - height(i));

  // Then everything settles downwards again, which also brings back a run that was pulled off
  // the top of the field. A card above the pivot keeps the place the pass above gave it.
  const from = at(0) < 0 ? 0 : Math.max(pivot, 0);
  tops[from] = Math.max(0, at(from));
  for (let i = Math.max(from + 1, 1); i < sorted.length; i += 1) {
    const floor = at(i - 1) + height(i - 1) + gap;
    tops[i] = Math.max(i <= pivot ? at(i) : want(i), floor, 0);
  }

  return sorted.map((item, index) => ({ key: item.key, top: Math.round(at(index)) }));
}

/** How tall the field has to be for every group to fit inside it. */
export function fieldHeight(items: StackItem[], placed: Placement[]): number {
  const heights = new Map(items.map((item) => [item.key, item.height]));
  return placed.reduce((tallest, one) => Math.max(tallest, one.top + (heights.get(one.key) ?? 0)), 0);
}
