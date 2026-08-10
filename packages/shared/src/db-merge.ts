import type { Database, DbView } from './databases.js';

/**
 * Merging two database schema edits.
 *
 * A schema write sends the whole schema, so two edits made from the same starting point overwrite
 * each other: click "Add a property" twice quickly and only the second property survives. The
 * cure is the one the page body already uses. The writer says which revision it started from, and
 * the server settles the two edits against that base instead of taking the last one whole.
 *
 * Properties and views both carry permanent ids, so the settlement is per id and needs no
 * guessing: two additions both survive, an edit on one side wins over an untouched other side,
 * and only the same id edited differently on both sides is a real conflict.
 */

/** A stable revision of a schema. Two equal schemas always hash the same. */
export function databaseRev(database: Database): string {
  return hash(canonical(database));
}

export interface DatabaseMerge {
  database: Database;
  /** False when the two edits genuinely overlap. `database` is then `theirs`, untouched. */
  clean: boolean;
}

/**
 * Settle `mine` and `theirs`, both written from `base`. Order comes from whichever side moved
 * things, and a reference to a property that neither side kept is dropped, so the result is
 * always a schema the grid can draw.
 */
export function mergeDatabases(base: Database, mine: Database, theirs: Database): DatabaseMerge {
  const properties = mergeById(base.properties, mine.properties, theirs.properties);
  const views = mergeById(base.views, mine.views, theirs.views);
  if (properties === null || views === null) return { database: theirs, clean: false };

  const kept = new Set(properties.map((property) => property.id));
  const pruned = views.map((view) => prune(view, kept));
  // A view is what a reader looks at, so the schema keeps at least one even after a merge.
  if (pruned.length === 0) return { database: theirs, clean: false };
  return { database: { properties, views: pruned }, clean: true };
}

// ---------------------------------------------------------------------------
// the id-keyed settlement
// ---------------------------------------------------------------------------

interface Keyed {
  id: string;
}

/**
 * One list, settled per id. Null means the two sides overlap: the same id changed differently on
 * both, or one side deleted what the other side changed.
 */
function mergeById<T extends Keyed>(base: T[], mine: T[], theirs: T[]): T[] | null {
  const wasBase = index(base);
  const wasMine = index(mine);
  const wasTheirs = index(theirs);

  const settled = new Map<string, T>();
  for (const id of new Set([...wasBase.keys(), ...wasMine.keys(), ...wasTheirs.keys()])) {
    const outcome = settle(wasBase.get(id), wasMine.get(id), wasTheirs.get(id));
    if (outcome === CONFLICT) return null;
    if (outcome !== null) settled.set(id, outcome);
  }

  return order(settled, base, mine, theirs);
}

/** A conflict is its own value, because null already means "deleted, and rightly so". */
const CONFLICT = Symbol('conflict');

function settle<T extends Keyed>(
  base: T | undefined,
  mine: T | undefined,
  theirs: T | undefined,
): T | null | typeof CONFLICT {
  // Neither side knew it. Unreachable, but the type says it is possible.
  if (mine === undefined && theirs === undefined) return null;
  // One side added it and the other never saw it.
  if (base === undefined) {
    if (mine === undefined) return theirs ?? null;
    if (theirs === undefined) return mine;
    // Both added the same id, which only happens if they added the same thing.
    return same(mine, theirs) ? mine : CONFLICT;
  }

  const iChanged = mine !== undefined && !same(base, mine);
  const theyChanged = theirs !== undefined && !same(base, theirs);

  // I deleted it. That stands unless they were changing it at the same moment.
  if (mine === undefined) return theyChanged ? CONFLICT : null;
  // They deleted it. Same rule the other way round.
  if (theirs === undefined) return iChanged ? CONFLICT : null;

  if (!iChanged) return theirs;
  if (!theyChanged) return mine;
  return same(mine, theirs) ? mine : CONFLICT;
}

/**
 * The order to lay the survivors out in. Whichever side moved the common items decides; when
 * both moved them the server's order wins, because order is a preference and not a fact. What a
 * side added is appended in the order that side added it.
 */
function order<T extends Keyed>(settled: Map<string, T>, base: T[], mine: T[], theirs: T[]): T[] {
  const common = (list: T[]): string[] =>
    list.map((item) => item.id).filter((id) => settled.has(id) && has(base, id));
  const iMoved = !sameOrder(common(mine), common(base));
  const lead = iMoved && sameOrder(common(theirs), common(base)) ? mine : theirs;

  const out: T[] = [];
  const taken = new Set<string>();
  for (const list of [lead, mine, theirs]) {
    for (const item of list) {
      const settledItem = settled.get(item.id);
      if (settledItem === undefined || taken.has(item.id)) continue;
      taken.add(item.id);
      out.push(settledItem);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function index<T extends Keyed>(list: T[]): Map<string, T> {
  return new Map(list.map((item) => [item.id, item]));
}

function has<T extends Keyed>(list: T[], id: string): boolean {
  return list.some((item) => item.id === id);
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at]);
}

function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** A view with every reference to a property nobody kept taken out. */
function prune(view: DbView, kept: Set<string>): DbView {
  const next: DbView = {
    ...view,
    filters: view.filters.filter((filter) => kept.has(filter.property)),
    sorts: view.sorts.filter((sort) => kept.has(sort.property)),
    hidden: view.hidden.filter((id) => kept.has(id)),
  };
  if (next.groupBy !== undefined && !kept.has(next.groupBy)) delete next.groupBy;
  return next;
}

/** JSON with the keys in a fixed order, so two equal values always read the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, held]) => held !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${canonical(held)}`).join(',')}}`;
}

/** FNV-1a over the canonical text. Short, stable, and never leaves the process. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    h ^= text.charCodeAt(at);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `db${h.toString(36)}${text.length.toString(36)}`;
}
