import { z } from 'zod';
import { newUlid } from './ids.js';

/**
 * Databases. A database is a page; a row is a record inside that page, not a page of its own.
 *
 * The schema and the views live in the database page's frontmatter under `db`, and the rows live
 * beside them under `rows`. Nothing is stored outside the markdown file, so a database survives a
 * clone, an editor and a `git push`, and a row never reaches the sidebar or the search index.
 */

export const PROPERTY_ID_PREFIX = 'pr_';
export const VIEW_ID_PREFIX = 'vw_';
export const OPTION_ID_PREFIX = 'op_';
export const ROW_ID_PREFIX = 'rw_';

const ULID_BODY = '[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}';
const PROPERTY_ID_RE = new RegExp(`^pr_${ULID_BODY}$`);
const VIEW_ID_RE = new RegExp(`^vw_${ULID_BODY}$`);
const OPTION_ID_RE = new RegExp(`^op_${ULID_BODY}$`);
const ROW_ID_RE = new RegExp(`^rw_${ULID_BODY}$`);

export const isPropertyId = (value: unknown): value is string =>
  typeof value === 'string' && PROPERTY_ID_RE.test(value);
export const isViewId = (value: unknown): value is string =>
  typeof value === 'string' && VIEW_ID_RE.test(value);
export const isOptionId = (value: unknown): value is string =>
  typeof value === 'string' && OPTION_ID_RE.test(value);
export const isRowId = (value: unknown): value is string =>
  typeof value === 'string' && ROW_ID_RE.test(value);

export const newPropertyId = (now?: number): string => PROPERTY_ID_PREFIX + newUlid(now);
export const newViewId = (now?: number): string => VIEW_ID_PREFIX + newUlid(now);
export const newOptionId = (now?: number): string => OPTION_ID_PREFIX + newUlid(now);
export const newRowId = (now?: number): string => ROW_ID_PREFIX + newUlid(now);

export const PropertyIdSchema = z.string().refine(isPropertyId, 'Expected a property id like "pr_<ULID>"');
export const ViewIdSchema = z.string().refine(isViewId, 'Expected a view id like "vw_<ULID>"');
export const OptionIdSchema = z.string().refine(isOptionId, 'Expected an option id like "op_<ULID>"');
export const RowIdSchema = z.string().refine(isRowId, 'Expected a row id like "rw_<ULID>"');

// ---------------------------------------------------------------------------
// properties
// ---------------------------------------------------------------------------

export const PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'person',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** The palette a select option is drawn in. Fixed, so a theme can style every one of them. */
export const OPTION_COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export const SelectOptionSchema = z.object({
  id: OptionIdSchema,
  name: z.string().min(1).max(100),
  color: z.enum(OPTION_COLORS),
});
export type SelectOption = z.infer<typeof SelectOptionSchema>;

export const NUMBER_FORMATS = ['plain', 'integer', 'percent', 'currency'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const DbPropertySchema = z.object({
  id: PropertyIdSchema,
  name: z.string().min(1).max(100),
  type: z.enum(PROPERTY_TYPES),
  /** Only for `select` and `multi_select`. Any other type carries an empty list. */
  options: z.array(SelectOptionSchema).max(200),
  /** Only for `number`. */
  format: z.enum(NUMBER_FORMATS).optional(),
});
export type DbProperty = z.infer<typeof DbPropertySchema>;

// ---------------------------------------------------------------------------
// values
// ---------------------------------------------------------------------------

/**
 * One cell. `null` means empty, and an empty cell is never written to the file.
 *
 * - text, url: string
 * - number: number
 * - checkbox: boolean
 * - select: option id
 * - multi_select: option ids
 * - date: `YYYY-MM-DD`, or `YYYY-MM-DD/YYYY-MM-DD` for a range
 * - person: account ids
 */
export const PropValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type PropValue = z.infer<typeof PropValueSchema>;

export const RowPropsSchema = z.record(PropertyIdSchema, PropValueSchema);
export type RowProps = z.infer<typeof RowPropsSchema>;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_RANGE_RE = /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/;

/** The start of a date value, which is the whole of it unless it is a range. */
export function dateStart(value: string): string {
  return value.split('/')[0] ?? value;
}

/** The end of a date value. A plain date starts and ends on the same day. */
export function dateEnd(value: string): string {
  const parts = value.split('/');
  return parts[1] ?? parts[0] ?? value;
}

/**
 * Coerce a value to what the property can hold, or `null` when it cannot hold it at all.
 * A file edited by hand may say anything, so every read goes through here.
 */
export function coerceValue(property: DbProperty, value: unknown): PropValue {
  if (value === null || value === undefined) return null;
  switch (property.type) {
    case 'text':
      return typeof value === 'string' && value.length > 0 ? value : null;
    case 'url':
      return typeof value === 'string' && value.length > 0 ? value : null;
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value !== 'string' || value.trim().length === 0) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'checkbox':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    case 'date':
      if (typeof value !== 'string') return null;
      return DATE_RE.test(value) || DATE_RANGE_RE.test(value) ? value : null;
    case 'select':
      if (typeof value !== 'string') return null;
      return property.options.some((option) => option.id === value) ? value : null;
    case 'multi_select': {
      if (!Array.isArray(value)) return null;
      const kept = value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && property.options.some((option) => option.id === entry),
      );
      return kept.length > 0 ? kept : null;
    }
    case 'person': {
      if (!Array.isArray(value)) return null;
      const kept = value.filter(
        (entry): entry is string => typeof entry === 'string' && entry.length > 0,
      );
      return kept.length > 0 ? kept : null;
    }
  }
}

/** Every value of a row, dropped to what the current schema can hold. */
export function coerceProps(properties: readonly DbProperty[], raw: unknown): RowProps {
  const out: RowProps = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const record = raw as Record<string, unknown>;
  for (const property of properties) {
    const value = coerceValue(property, record[property.id]);
    if (value !== null) out[property.id] = value;
  }
  return out;
}

/** True when the cell holds nothing a reader would see. */
export function isEmptyValue(value: PropValue): boolean {
  if (value === null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'boolean') return !value;
  return false;
}

// ---------------------------------------------------------------------------
// filters and sorts
// ---------------------------------------------------------------------------

export const FILTER_OPS = [
  'is',
  'is_not',
  'contains',
  'does_not_contain',
  'is_empty',
  'is_not_empty',
  'gt',
  'lt',
  'before',
  'after',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** The operators that make sense for each property type, in menu order. */
export const OPS_FOR_TYPE: Record<PropertyType, readonly FilterOp[]> = {
  text: ['contains', 'does_not_contain', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  url: ['contains', 'does_not_contain', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  number: ['is', 'is_not', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  checkbox: ['is'],
  date: ['is', 'before', 'after', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  multi_select: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  person: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
};

/** True when the operator reads no value from the user. */
export function opTakesNoValue(op: FilterOp): boolean {
  return op === 'is_empty' || op === 'is_not_empty';
}

export const FilterSchema = z.object({
  property: PropertyIdSchema,
  op: z.enum(FILTER_OPS),
  value: PropValueSchema,
});
export type DbFilter = z.infer<typeof FilterSchema>;

export const SortSchema = z.object({
  property: PropertyIdSchema,
  direction: z.enum(['asc', 'desc']),
});
export type DbSort = z.infer<typeof SortSchema>;

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

export const VIEW_TYPES = ['table', 'board'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const DbViewSchema = z.object({
  id: ViewIdSchema,
  name: z.string().min(1).max(100),
  type: z.enum(VIEW_TYPES),
  filters: z.array(FilterSchema).max(50),
  sorts: z.array(SortSchema).max(20),
  /** Properties the view hides. Order follows the schema, so only visibility is stored. */
  hidden: z.array(PropertyIdSchema).max(200),
  /** The select property a board view stacks its cards by. Only a board reads it. */
  groupBy: PropertyIdSchema.optional(),
});
export type DbView = z.infer<typeof DbViewSchema>;

export const DatabaseSchema = z.object({
  properties: z.array(DbPropertySchema).max(200),
  views: z.array(DbViewSchema).min(1).max(50),
});
export type Database = z.infer<typeof DatabaseSchema>;

/**
 * How many rows one database holds. A row is a record inside the page file, so the whole
 * database is read and written as one unit, and the cap is what keeps that write small.
 */
export const MAX_ROWS = 5000;

/** A row: an id, a title, and the values of the current schema. It is not a page. */
export const DbRowSchema = z.object({
  id: RowIdSchema,
  title: z.string().max(200),
  icon: z.string().max(64).optional(),
  created: z.string(),
  updated: z.string(),
  props: RowPropsSchema,
});
export type DbRow = z.infer<typeof DbRowSchema>;

export const DbRowsSchema = z.array(DbRowSchema).max(MAX_ROWS);

export const DEFAULT_VIEW_NAME = 'Table';

/** What a row is called until somebody names it. */
export const UNTITLED_ROW = 'Untitled';

/** A row with no cells filled in, ready for the caller to write over. */
export function newRow(title: string, at: string, now?: number): DbRow {
  return { id: newRowId(now), title, created: at, updated: at, props: {} };
}

/** The database a brand new page is turned into: one text column and one table view. */
export function starterDatabase(now?: number): Database {
  return {
    properties: [
      { id: newPropertyId(now), name: 'Status', type: 'select', options: [] },
      { id: newPropertyId(now), name: 'Notes', type: 'text', options: [] },
    ],
    views: [
      {
        id: newViewId(now),
        name: DEFAULT_VIEW_NAME,
        type: 'table',
        filters: [],
        sorts: [],
        hidden: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

function textOf(property: DbProperty, value: PropValue): string {
  if (value === null) return '';
  if (property.type === 'select') {
    return property.options.find((option) => option.id === value)?.name ?? '';
  }
  if (property.type === 'multi_select') {
    if (!Array.isArray(value)) return '';
    return value
      .map((id) => property.options.find((option) => option.id === id)?.name ?? '')
      .join(' ');
  }
  if (Array.isArray(value)) return value.join(' ');
  return String(value);
}

function matches(property: DbProperty, filter: DbFilter, value: PropValue): boolean {
  const empty = isEmptyValue(value);
  if (filter.op === 'is_empty') return empty;
  if (filter.op === 'is_not_empty') return !empty;

  if (property.type === 'checkbox') {
    const wanted = filter.value === true || filter.value === 'true';
    return (value === true) === wanted;
  }

  if (property.type === 'number') {
    if (typeof value !== 'number') return false;
    const target = typeof filter.value === 'number' ? filter.value : Number(filter.value);
    if (!Number.isFinite(target)) return false;
    if (filter.op === 'gt') return value > target;
    if (filter.op === 'lt') return value < target;
    if (filter.op === 'is') return value === target;
    if (filter.op === 'is_not') return value !== target;
    return false;
  }

  if (property.type === 'date') {
    if (typeof value !== 'string' || value.length === 0) return false;
    const target = typeof filter.value === 'string' ? filter.value : '';
    if (target.length === 0) return false;
    if (filter.op === 'before') return dateStart(value) < dateStart(target);
    if (filter.op === 'after') return dateEnd(value) > dateEnd(target);
    if (filter.op === 'is') return dateStart(value) === dateStart(target);
    return false;
  }

  if (property.type === 'select') {
    if (filter.op === 'is') return value === filter.value;
    if (filter.op === 'is_not') return value !== filter.value;
    return false;
  }

  if (property.type === 'multi_select' || property.type === 'person') {
    const held = Array.isArray(value) ? value : [];
    const wanted = typeof filter.value === 'string' ? filter.value : '';
    if (filter.op === 'contains') return held.includes(wanted);
    if (filter.op === 'does_not_contain') return !held.includes(wanted);
    return false;
  }

  // text and url compare case-insensitively, which is what a reader expects of a search box.
  const haystack = textOf(property, value).toLowerCase();
  const needle = (typeof filter.value === 'string' ? filter.value : '').toLowerCase();
  if (filter.op === 'contains') return haystack.includes(needle);
  if (filter.op === 'does_not_contain') return !haystack.includes(needle);
  if (filter.op === 'is') return haystack === needle;
  if (filter.op === 'is_not') return haystack !== needle;
  return false;
}

/** Rows the view keeps, in the view's order. Filters are joined with AND, as Notion does. */
export function applyView(
  database: Database,
  view: DbView,
  rows: readonly DbRow[],
): DbRow[] {
  const byId = new Map(database.properties.map((property) => [property.id, property]));

  const kept = rows.filter((row) =>
    view.filters.every((filter) => {
      const property = byId.get(filter.property);
      // A filter on a deleted property is ignored, never treated as "nothing matches".
      if (property === undefined) return true;
      return matches(property, filter, row.props[filter.property] ?? null);
    }),
  );

  const sorts = view.sorts.filter((sort) => byId.has(sort.property));
  if (sorts.length === 0) return kept;

  return [...kept].sort((left, right) => {
    for (const sort of sorts) {
      const property = byId.get(sort.property);
      if (property === undefined) continue;
      const a = left.props[sort.property] ?? null;
      const b = right.props[sort.property] ?? null;
      // An empty cell sinks either way. Only the filled cells answer to the direction.
      if (a === null || b === null) {
        if (a === null && b === null) continue;
        return a === null ? 1 : -1;
      }
      const order = compareValues(property, a, b);
      if (order !== 0) return sort.direction === 'asc' ? order : -order;
    }
    // A stable tie-break, or two rows would swap places on every re-render.
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/** Compare two cells of the same property. An empty cell always sorts last. */
export function compareValues(property: DbProperty, left: PropValue, right: PropValue): number {
  const leftEmpty = left === null;
  const rightEmpty = right === null;
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  if (property.type === 'number') {
    const a = typeof left === 'number' ? left : 0;
    const b = typeof right === 'number' ? right : 0;
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (property.type === 'checkbox') {
    const a = left === true ? 1 : 0;
    const b = right === true ? 1 : 0;
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (property.type === 'select') {
    // Select sorts by the order of the options, which is the order the author arranged.
    const a = property.options.findIndex((option) => option.id === left);
    const b = property.options.findIndex((option) => option.id === right);
    return a === b ? 0 : a < b ? -1 : 1;
  }
  const a = textOf(property, left);
  const b = textOf(property, right);
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// boards
// ---------------------------------------------------------------------------

export const DEFAULT_BOARD_NAME = 'Board';

/** The same starter database, drawn as a board from the first moment. `/Board view` makes this. */
export function starterBoard(now?: number): Database {
  const database = starterDatabase(now);
  const status = database.properties.find((entry) => entry.type === 'select');
  const [view] = database.views;
  if (view === undefined) return database;

  const board: DbView = { ...view, name: DEFAULT_BOARD_NAME, type: 'board' };
  if (status !== undefined) board.groupBy = status.id;
  return { ...database, views: [board] };
}

/** One stack of cards on a board. `option` is null for the cards that hold no value. */
export interface BoardGroup {
  id: string | null;
  name: string;
  color: OptionColor;
  rows: DbRow[];
}

/**
 * The property a board stacks its cards by: the one the view names, or the first select column
 * when the view names none or names one that is gone. Null when the database has no select column.
 */
export function boardProperty(database: Database, view: DbView): DbProperty | null {
  const named = database.properties.find((entry) => entry.id === view.groupBy);
  if (named !== undefined && named.type === 'select') return named;
  return database.properties.find((entry) => entry.type === 'select') ?? null;
}

/**
 * The stacks of a board, left to right: one for each option in the order the author arranged
 * them, and last the cards that hold no option at all. Filters and sorts apply first, exactly
 * as on a table. The work of the board is in the named stacks, so they come first.
 */
export function boardGroups(
  database: Database,
  view: DbView,
  rows: readonly DbRow[],
): BoardGroup[] {
  const property = boardProperty(database, view);
  const shown = applyView(database, view, rows);
  if (property === null) return [{ id: null, name: 'All', color: 'gray', rows: shown }];

  const empty: BoardGroup = { id: null, name: `No ${property.name}`, color: 'gray', rows: [] };
  const groups: BoardGroup[] = [
    ...property.options.map((option) => ({
      id: option.id,
      name: option.name,
      color: option.color,
      rows: [] as DbRow[],
    })),
    empty,
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));

  for (const row of shown) {
    const value = row.props[property.id] ?? null;
    // A value naming an option nobody kept lands with the cards that hold no value at all.
    const group = typeof value === 'string' ? byId.get(value) : undefined;
    (group ?? empty).rows.push(row);
  }
  return groups;
}

/**
 * Put one row in front of another, or at the end of the list when `before` is null.
 *
 * The board keeps no order of its own: a card sits where its row sits in the file, so a card
 * dragged up its own stack is a move inside this one array. A name nothing answers to means the
 * end, because the row it named may have been deleted while the card was in the air.
 */
export function moveRowBefore(
  rows: readonly DbRow[],
  rowId: string,
  before: string | null,
): DbRow[] {
  const moved = rows.find((row) => row.id === rowId);
  if (moved === undefined) return [...rows];

  const rest = rows.filter((row) => row.id !== rowId);
  const at = before === null ? -1 : rest.findIndex((row) => row.id === before);
  if (at < 0) return [...rest, moved];
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}
