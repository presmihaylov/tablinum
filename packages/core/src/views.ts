import { parentPath, type PagePath, type PageSummary, type PropValue } from '@gitdocs/shared';

/** One `key:value` equality clause of a view's `where`. */
export interface ViewFilter {
  key: string;
  value: string;
}

export interface ViewQuery {
  /** Page whose direct children make up the table. */
  dir: PagePath;
  where?: readonly ViewFilter[];
  /** Prop key, or one of title, path, order, created, updated. */
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface ViewResult {
  /** Union of the prop keys of every row, sorted. */
  columns: string[];
  rows: PageSummary[];
}

const BUILT_IN_KEYS = new Set(['title', 'path', 'id', 'icon', 'space', 'order', 'created', 'updated', 'tag', 'tags']);

/** Turn `parseWhere()`'s record into filter clauses. */
export function filtersFromRecord(where: Record<string, string>): ViewFilter[] {
  return Object.entries(where).map(([key, value]) => ({ key, value }));
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function propMatches(value: PropValue, needle: string): boolean {
  if (value === null) return needle.length === 0 || equalsIgnoreCase(needle, 'null');
  if (Array.isArray(value)) return value.some((item) => equalsIgnoreCase(item, needle));
  return equalsIgnoreCase(String(value), needle);
}

function builtInValue(page: PageSummary, key: string): PropValue | undefined {
  if (key === 'title') return page.title;
  if (key === 'path') return page.path;
  if (key === 'id') return page.id;
  if (key === 'icon') return page.icon ?? null;
  if (key === 'space') return page.space;
  if (key === 'order') return page.order ?? null;
  if (key === 'created') return page.created;
  if (key === 'updated') return page.updated;
  if (key === 'tag' || key === 'tags') return page.tags;
  return undefined;
}

function matchesFilter(page: PageSummary, filter: ViewFilter): boolean {
  const prop = page.props[filter.key];
  if (prop !== undefined) return propMatches(prop, filter.value);
  if (!BUILT_IN_KEYS.has(filter.key)) return false;
  const built = builtInValue(page, filter.key);
  if (built === undefined) return false;
  return propMatches(built, filter.value);
}

function sortValue(page: PageSummary, key: string): PropValue | undefined {
  const prop = page.props[key];
  if (prop !== undefined) return prop;
  return builtInValue(page, key);
}

function isMissing(value: PropValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return value === '';
}

function compareValues(a: PropValue, b: PropValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  const left = Array.isArray(a) ? a.join(', ') : String(a);
  const right = Array.isArray(b) ? b.join(', ') : String(b);
  const compared = left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
  if (compared !== 0) return compared;
  return left < right ? -1 : left > right ? 1 : 0;
}

function tieBreak(a: PageSummary, b: PageSummary): number {
  const byTitle = a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' });
  if (byTitle !== 0) return byTitle;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function defaultCompare(a: PageSummary, b: PageSummary): number {
  const left = a.order ?? Number.POSITIVE_INFINITY;
  const right = b.order ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left < right ? -1 : 1;
  return tieBreak(a, b);
}

/**
 * A table over the direct children of `dir`, filtered by frontmatter props.
 * Rows keep their full PageSummary so the caller can render any column it likes.
 */
export function queryView(pages: readonly PageSummary[], query: ViewQuery): ViewResult {
  const filters = query.where ?? [];
  const rows = pages.filter((page) => {
    if (parentPath(page.path) !== query.dir) return false;
    return filters.every((filter) => matchesFilter(page, filter));
  });

  const direction = query.order === 'desc' ? -1 : 1;
  const sortKey = query.sort;
  rows.sort((a, b) => {
    if (sortKey === undefined) return defaultCompare(a, b) * direction;
    const left = sortValue(a, sortKey);
    const right = sortValue(b, sortKey);
    const leftMissing = isMissing(left);
    const rightMissing = isMissing(right);
    if (leftMissing && rightMissing) return tieBreak(a, b);
    if (leftMissing) return 1; // rows without the sort key always sit at the bottom
    if (rightMissing) return -1;
    const compared = compareValues(left ?? null, right ?? null);
    if (compared !== 0) return compared * direction;
    return tieBreak(a, b);
  });

  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.props)) columns.add(key);
  }

  return {
    columns: [...columns].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    rows,
  };
}
