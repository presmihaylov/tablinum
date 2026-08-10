import {
  DEFAULT_VIEW_NAME,
  FILTER_OPS,
  MAX_ROWS,
  NUMBER_FORMATS,
  OPTION_COLORS,
  PROPERTY_TYPES,
  UNTITLED_ROW,
  VIEW_TYPES,
  isOptionId,
  isPropertyId,
  isRowId,
  isViewId,
  newViewId,
  type Database,
  type DbFilter,
  type DbProperty,
  type DbRow,
  type DbSort,
  type DbView,
  type FilterOp,
  type NumberFormat,
  type OptionColor,
  type PropValue,
  type PropertyType,
  type RowProps,
  type SelectOption,
  type ViewType,
} from '@tablinum/shared';
import { emitNumber, emitString } from './yaml-emit.js';

/**
 * The `db` and `rows` frontmatter blocks.
 *
 * Reading never throws and never gives up on a whole block: a hand-edited file keeps every part
 * of it that still makes sense, and only the parts that do not are dropped. Writing is done by
 * hand rather than by a YAML library, so the emitted block follows exactly the quoting rules the
 * rest of the frontmatter already uses.
 */

export interface ReadResult<T> {
  value: T | null;
  /** False when something had to be dropped or invented, which means the file must be rewritten. */
  exact: boolean;
}

const INDENT = '  ';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inList<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function readName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > 100 ? null : trimmed;
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

function readOption(raw: unknown, seen: Set<string>): SelectOption | null {
  if (!isRecord(raw)) return null;
  const id = raw['id'];
  if (!isOptionId(id) || seen.has(id)) return null;
  const name = readName(raw['name']);
  if (name === null) return null;
  const color: OptionColor = inList(OPTION_COLORS, raw['color']) ? raw['color'] : 'gray';
  seen.add(id);
  return { id, name, color };
}

function readProperty(raw: unknown, seen: Set<string>): { value: DbProperty | null; exact: boolean } {
  if (!isRecord(raw)) return { value: null, exact: false };
  const id = raw['id'];
  if (!isPropertyId(id) || seen.has(id)) return { value: null, exact: false };
  const name = readName(raw['name']);
  if (name === null) return { value: null, exact: false };
  if (!inList(PROPERTY_TYPES, raw['type'])) return { value: null, exact: false };
  const type: PropertyType = raw['type'];
  seen.add(id);

  let exact = name === raw['name'];

  const options: SelectOption[] = [];
  const rawOptions = raw['options'];
  const optionIds = new Set<string>();
  if (Array.isArray(rawOptions)) {
    for (const entry of rawOptions) {
      const option = readOption(entry, optionIds);
      if (option === null) {
        exact = false;
        continue;
      }
      options.push(option);
    }
  }
  // A type that holds no options must not carry any, or the file grows a block nobody reads.
  const keepsOptions = type === 'select' || type === 'multi_select';
  if (!keepsOptions && options.length > 0) exact = false;

  const property: DbProperty = { id, name, type, options: keepsOptions ? options : [] };
  if (type === 'number' && inList(NUMBER_FORMATS, raw['format'])) {
    property.format = raw['format'] as NumberFormat;
  }
  if (type !== 'number' && raw['format'] !== undefined) exact = false;
  return { value: property, exact };
}

/** A single cell value, as far as it can be read without knowing the property it belongs to. */
export function readPropValue(raw: unknown): PropValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    // YAML 1.1 reads `2026-08-12` as a date. A cell holding one is always meant as text.
    return raw.toISOString().slice(0, 10);
  }
  if (!Array.isArray(raw)) return null;
  const list = raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return list.length > 0 ? list : null;
}

function readFilter(raw: unknown): DbFilter | null {
  if (!isRecord(raw)) return null;
  const property = raw['property'];
  if (!isPropertyId(property)) return null;
  if (!inList(FILTER_OPS, raw['op'])) return null;
  return { property, op: raw['op'] as FilterOp, value: readPropValue(raw['value']) };
}

function readSort(raw: unknown): DbSort | null {
  if (!isRecord(raw)) return null;
  const property = raw['property'];
  if (!isPropertyId(property)) return null;
  const direction = raw['direction'] === 'desc' ? 'desc' : 'asc';
  return { property, direction };
}

function readView(raw: unknown, seen: Set<string>): { value: DbView | null; exact: boolean } {
  if (!isRecord(raw)) return { value: null, exact: false };
  const id = raw['id'];
  if (!isViewId(id) || seen.has(id)) return { value: null, exact: false };
  const name = readName(raw['name']);
  if (name === null) return { value: null, exact: false };
  if (!inList(VIEW_TYPES, raw['type'])) return { value: null, exact: false };
  seen.add(id);

  let exact = name === raw['name'];
  const filters: DbFilter[] = [];
  const sorts: DbSort[] = [];
  const hidden: string[] = [];

  for (const entry of Array.isArray(raw['filters']) ? raw['filters'] : []) {
    const filter = readFilter(entry);
    if (filter === null) {
      exact = false;
      continue;
    }
    filters.push(filter);
  }
  for (const entry of Array.isArray(raw['sorts']) ? raw['sorts'] : []) {
    const sort = readSort(entry);
    if (sort === null) {
      exact = false;
      continue;
    }
    sorts.push(sort);
  }
  for (const entry of Array.isArray(raw['hidden']) ? raw['hidden'] : []) {
    if (!isPropertyId(entry) || hidden.includes(entry)) {
      exact = false;
      continue;
    }
    hidden.push(entry);
  }

  const view: DbView = { id, name, type: raw['type'] as ViewType, filters, sorts, hidden };
  if (isPropertyId(raw['groupBy'])) view.groupBy = raw['groupBy'];
  if (raw['groupBy'] !== undefined && view.groupBy === undefined) exact = false;

  return { value: view, exact };
}

/**
 * The `db` block. Null when the page is not a database, which includes a block so broken that
 * nothing usable is left in it.
 */
export function readDatabase(raw: unknown, now?: number): ReadResult<Database> {
  if (raw === undefined || raw === null) return { value: null, exact: true };
  if (!isRecord(raw)) return { value: null, exact: false };

  let exact = true;
  const properties: DbProperty[] = [];
  const propertyIds = new Set<string>();
  for (const entry of Array.isArray(raw['properties']) ? raw['properties'] : []) {
    const property = readProperty(entry, propertyIds);
    if (!property.exact) exact = false;
    if (property.value !== null) properties.push(property.value);
  }
  if (raw['properties'] !== undefined && !Array.isArray(raw['properties'])) exact = false;

  const views: DbView[] = [];
  const viewIds = new Set<string>();
  for (const entry of Array.isArray(raw['views']) ? raw['views'] : []) {
    const view = readView(entry, viewIds);
    if (!view.exact) exact = false;
    if (view.value !== null) views.push(view.value);
  }
  if (views.length === 0) {
    // A database with no view cannot be shown at all, so it gets the default one back.
    views.push({
      id: newViewId(now),
      name: DEFAULT_VIEW_NAME,
      type: 'table',
      filters: [],
      sorts: [],
      hidden: [],
    });
    exact = false;
  }

  return { value: { properties, views }, exact };
}

/** The `props` block of one row. Values are kept loosely; the schema narrows them later. */
export function readRowProps(raw: unknown): ReadResult<RowProps> {
  if (raw === undefined || raw === null) return { value: null, exact: true };
  if (!isRecord(raw)) return { value: null, exact: false };

  let exact = true;
  const props: RowProps = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!isPropertyId(key)) {
      exact = false;
      continue;
    }
    const value = readPropValue(entry);
    if (value === null) {
      // An empty cell is never written, so dropping it is only a repair when it was written.
      if (entry !== null && entry !== undefined) exact = false;
      continue;
    }
    if (Array.isArray(entry) && Array.isArray(value) && entry.length !== value.length) exact = false;
    props[key] = value;
  }
  if (Object.keys(props).length === 0) return { value: null, exact };
  return { value: props, exact };
}

/** A timestamp the file claims. A hand-edited one may say anything, so it is only kept as text. */
function readStamp(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  return fallback;
}

function readRow(raw: unknown, seen: Set<string>, at: string): { value: DbRow | null; exact: boolean } {
  if (!isRecord(raw)) return { value: null, exact: false };
  const id = raw['id'];
  if (!isRowId(id) || seen.has(id)) return { value: null, exact: false };
  seen.add(id);

  let exact = true;
  const title = typeof raw['title'] === 'string' ? raw['title'].slice(0, 200) : UNTITLED_ROW;
  if (title !== raw['title']) exact = false;

  const created = readStamp(raw['created'], at);
  const updated = readStamp(raw['updated'], created);
  if (created !== raw['created'] || updated !== raw['updated']) exact = false;

  const props = readRowProps(raw['props']);
  if (!props.exact) exact = false;

  const row: DbRow = { id, title, created, updated, props: props.value ?? {} };
  if (typeof raw['icon'] === 'string' && raw['icon'].length > 0) row.icon = raw['icon'].slice(0, 64);
  if (raw['icon'] !== undefined && row.icon === undefined) exact = false;
  return { value: row, exact };
}

/**
 * The `rows` block. A row is a record inside the database page, so a file that lists more than
 * the cap keeps only the first `MAX_ROWS` of them.
 */
export function readRows(raw: unknown, at: string): ReadResult<DbRow[]> {
  if (raw === undefined || raw === null) return { value: null, exact: true };
  if (!Array.isArray(raw)) return { value: null, exact: false };

  let exact = true;
  const rows: DbRow[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    if (rows.length >= MAX_ROWS) {
      exact = false;
      break;
    }
    const row = readRow(entry, ids, at);
    if (!row.exact) exact = false;
    if (row.value !== null) rows.push(row.value);
  }
  if (rows.length === 0) return { value: null, exact };
  return { value: rows, exact };
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

function emitValue(value: PropValue, indent: string, lines: string[], key: string): void {
  if (value === null) return;
  if (typeof value === 'boolean') {
    lines.push(`${indent}${key}: ${value ? 'true' : 'false'}`);
    return;
  }
  if (typeof value === 'number') {
    lines.push(`${indent}${key}: ${emitNumber(value)}`);
    return;
  }
  if (typeof value === 'string') {
    lines.push(`${indent}${key}: ${emitString(value)}`);
    return;
  }
  if (value.length === 0) return;
  lines.push(`${indent}${key}:`);
  for (const entry of value) lines.push(`${indent}${INDENT}- ${emitString(entry)}`);
}

/** The `db:` block, without a trailing newline. */
export function stringifyDatabase(database: Database): string {
  const lines: string[] = ['db:'];

  lines.push(`${INDENT}properties:`);
  for (const property of database.properties) {
    lines.push(`${INDENT}${INDENT}- id: ${property.id}`);
    const at = `${INDENT}${INDENT}  `;
    lines.push(`${at}name: ${emitString(property.name)}`);
    lines.push(`${at}type: ${property.type}`);
    if (property.format !== undefined) lines.push(`${at}format: ${property.format}`);
    if (property.options.length === 0) continue;
    lines.push(`${at}options:`);
    for (const option of property.options) {
      lines.push(`${at}${INDENT}- id: ${option.id}`);
      lines.push(`${at}${INDENT}  name: ${emitString(option.name)}`);
      lines.push(`${at}${INDENT}  color: ${option.color}`);
    }
  }

  lines.push(`${INDENT}views:`);
  for (const view of database.views) {
    lines.push(`${INDENT}${INDENT}- id: ${view.id}`);
    const at = `${INDENT}${INDENT}  `;
    lines.push(`${at}name: ${emitString(view.name)}`);
    lines.push(`${at}type: ${view.type}`);
    if (view.groupBy !== undefined) lines.push(`${at}groupBy: ${view.groupBy}`);
    if (view.filters.length > 0) {
      lines.push(`${at}filters:`);
      for (const filter of view.filters) {
        lines.push(`${at}${INDENT}- property: ${filter.property}`);
        lines.push(`${at}${INDENT}  op: ${filter.op}`);
        emitValue(filter.value, `${at}${INDENT}  `, lines, 'value');
      }
    }
    if (view.sorts.length > 0) {
      lines.push(`${at}sorts:`);
      for (const sort of view.sorts) {
        lines.push(`${at}${INDENT}- property: ${sort.property}`);
        lines.push(`${at}${INDENT}  direction: ${sort.direction}`);
      }
    }
    if (view.hidden.length > 0) {
      lines.push(`${at}hidden:`);
      for (const id of view.hidden) lines.push(`${at}${INDENT}- ${id}`);
    }
  }

  return lines.join('\n');
}

/** The `props:` block of one row, at the given indent. Empty cells are left out entirely. */
function emitRowProps(props: RowProps, indent: string, lines: string[]): void {
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return;
  lines.push(`${indent}props:`);
  for (const key of keys) emitValue(props[key] ?? null, `${indent}${INDENT}`, lines, key);
}

/** The `rows:` block, without a trailing newline. Empty when the database holds no row. */
export function stringifyRows(rows: readonly DbRow[]): string {
  if (rows.length === 0) return '';
  const lines: string[] = ['rows:'];
  for (const row of rows) {
    lines.push(`${INDENT}- id: ${row.id}`);
    const at = `${INDENT}  `;
    lines.push(`${at}title: ${emitString(row.title)}`);
    if (row.icon !== undefined) lines.push(`${at}icon: ${emitString(row.icon)}`);
    lines.push(`${at}created: ${emitString(row.created)}`);
    lines.push(`${at}updated: ${emitString(row.updated)}`);
    emitRowProps(row.props, at, lines);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// equality
// ---------------------------------------------------------------------------

function sameList<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => eq(entry, b[index] as T));
}

function sameValue(a: PropValue, b: PropValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return sameList(a, b, (x, y) => x === y);
  }
  return a === b;
}

export function databaseEqual(a: Database | undefined, b: Database | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const sameProperty = (x: DbProperty, y: DbProperty): boolean =>
    x.id === y.id &&
    x.name === y.name &&
    x.type === y.type &&
    (x.format ?? null) === (y.format ?? null) &&
    sameList(x.options, y.options, (o, p) => o.id === p.id && o.name === p.name && o.color === p.color);

  const sameView = (x: DbView, y: DbView): boolean =>
    x.id === y.id &&
    x.name === y.name &&
    x.type === y.type &&
    (x.groupBy ?? null) === (y.groupBy ?? null) &&
    sameList(x.filters, y.filters, (f, g) => f.property === g.property && f.op === g.op && sameValue(f.value, g.value)) &&
    sameList(x.sorts, y.sorts, (s, t) => s.property === t.property && s.direction === t.direction) &&
    sameList(x.hidden, y.hidden, (h, i) => h === i);

  return sameList(a.properties, b.properties, sameProperty) && sameList(a.views, b.views, sameView);
}

export function rowPropsEqual(a: RowProps | undefined, b: RowProps | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => sameValue(a[key] ?? null, b[key] ?? null));
}

export function rowsEqual(a: readonly DbRow[] | undefined, b: readonly DbRow[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameList(
    a,
    b,
    (x, y) =>
      x.id === y.id &&
      x.title === y.title &&
      (x.icon ?? null) === (y.icon ?? null) &&
      x.created === y.created &&
      x.updated === y.updated &&
      rowPropsEqual(x.props, y.props),
  );
}
