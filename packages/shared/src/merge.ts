/**
 * Three-way merge, the same shape git uses for a clean rebase: what each side changed against
 * a common base is applied, and only overlapping edits become a conflict.
 *
 * It lives in shared because both ends need the identical algorithm: the browser merges a live
 * update into what someone is typing, and the server merges a save that raced another one.
 */

export const CONFLICT_START = '<<<<<<<';
export const CONFLICT_MIDDLE = '=======';
export const CONFLICT_END = '>>>>>>>';

/** One region the two sides changed differently. Each field is plain text. */
export interface TextConflict {
  base: string;
  ours: string;
  theirs: string;
}

export interface TextMergeResult {
  /** True when every edit applied without an overlap. */
  clean: boolean;
  /** The merged text. When `clean` is false it carries git-style conflict markers. */
  text: string;
  conflicts: TextConflict[];
}

export interface MergeLabels {
  ours?: string;
  theirs?: string;
}

/** Replace `base[start, end)` with `items`. */
interface Change {
  start: number;
  end: number;
  items: string[];
}

/**
 * Above this the quadratic table would cost more memory than a page merge is worth, so the
 * differing middle is treated as one replaced block. Pages never come close.
 */
const MAX_CELLS = 4_000_000;

/** How many base lines a conflict may span before the word-level retry is skipped. */
const REFINE_MAX_LINES = 4;

function lcsChanges(a: readonly string[], b: readonly string[], offset: number): Change[] {
  const cols = b.length + 1;
  const table = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const at = i * cols + j;
      if (a[i] === b[j]) {
        table[at] = (table[at + cols + 1] ?? 0) + 1;
        continue;
      }
      table[at] = Math.max(table[at + cols] ?? 0, table[at + 1] ?? 0);
    }
  }

  const changes: Change[] = [];
  let pending: Change | null = null;
  const open = (i: number): Change => {
    if (pending !== null) return pending;
    pending = { start: offset + i, end: offset + i, items: [] };
    changes.push(pending);
    return pending;
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pending = null;
      i += 1;
      j += 1;
      continue;
    }
    const down = table[(i + 1) * cols + j] ?? 0;
    const right = table[i * cols + j + 1] ?? 0;
    if (down >= right) {
      open(i).end = offset + i + 1;
      i += 1;
      continue;
    }
    const line = b[j];
    if (line !== undefined) open(i).items.push(line);
    j += 1;
  }

  if (i < a.length || j < b.length) {
    const tailChange = open(i);
    tailChange.end = offset + a.length;
    for (let k = j; k < b.length; k += 1) {
      const line = b[k];
      if (line !== undefined) tailChange.items.push(line);
    }
  }

  return changes.filter((change) => change.end > change.start || change.items.length > 0);
}

/** Every edit that turns `base` into `other`, as replaced ranges of `base`, in order. */
function diffChanges(base: readonly string[], other: readonly string[]): Change[] {
  const limit = Math.min(base.length, other.length);
  let head = 0;
  while (head < limit && base[head] === other[head]) head += 1;
  let tail = 0;
  while (
    tail < limit - head &&
    base[base.length - 1 - tail] === other[other.length - 1 - tail]
  ) {
    tail += 1;
  }

  const baseMid = base.slice(head, base.length - tail);
  const otherMid = other.slice(head, other.length - tail);
  if (baseMid.length === 0 && otherMid.length === 0) return [];
  if (
    baseMid.length === 0 ||
    otherMid.length === 0 ||
    baseMid.length * otherMid.length > MAX_CELLS
  ) {
    return [{ start: head, end: base.length - tail, items: [...otherMid] }];
  }
  return lcsChanges(baseMid, otherMid, head);
}

/** Rebuild `base[start, end)` with these changes applied. They must all lie inside it. */
function applyIn(
  base: readonly string[],
  changes: readonly Change[],
  start: number,
  end: number,
): string[] {
  const out: string[] = [];
  let cursor = start;
  for (const change of changes) {
    out.push(...base.slice(cursor, change.start));
    out.push(...change.items);
    cursor = Math.max(cursor, change.end);
  }
  out.push(...base.slice(cursor, end));
  return out;
}

function sameItems(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

interface SequenceConflict {
  base: string[];
  ours: string[];
  theirs: string[];
}

interface SequenceMerge {
  clean: boolean;
  /** The merged sequence. A conflicting region is left out; `conflicts` describes it. */
  parts: Array<{ items: string[] } | { conflict: SequenceConflict }>;
}

/**
 * Whether `change` belongs to the region being grown.
 *
 * Two edits that merely meet at a boundary are independent and must not be decided together.
 * Treating them as one cluster is what made ten people editing ten separate paragraphs conflict
 * with each other: the run of lines above someone's paragraph ends exactly where theirs begins.
 * The single exception is a pair of insertions at the same offset, which have no range to
 * overlap with but still have to be ordered.
 */
function joinsRegion(change: Change, start: number, end: number, consumed: boolean): boolean {
  if (!consumed && change.start === start) return true;
  if (change.start < end) return true;
  if (change.start > end) return false;
  return start === end && change.start === change.end;
}

/**
 * The merge itself. Both sides are diffed against the base, then the base is walked once and
 * every cluster of overlapping edits is decided together.
 */
function mergeSequences(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
): SequenceMerge {
  const oursChanges = diffChanges(base, ours);
  const theirsChanges = diffChanges(base, theirs);

  const parts: SequenceMerge['parts'] = [];
  let clean = true;
  let cursor = 0;
  let a = 0;
  let b = 0;

  while (a < oursChanges.length || b < theirsChanges.length) {
    const start = Math.min(
      oursChanges[a]?.start ?? Number.POSITIVE_INFINITY,
      theirsChanges[b]?.start ?? Number.POSITIVE_INFINITY,
    );
    let end = start;

    // Grow the region while either side still has an edit that overlaps it.
    const firstOurs = a;
    const firstTheirs = b;
    let consumed = false;
    let grew = true;
    while (grew) {
      grew = false;
      while (a < oursChanges.length) {
        const change = oursChanges[a];
        if (change === undefined || !joinsRegion(change, start, end, consumed)) break;
        end = Math.max(end, change.end);
        a += 1;
        consumed = true;
        grew = true;
      }
      while (b < theirsChanges.length) {
        const change = theirsChanges[b];
        if (change === undefined || !joinsRegion(change, start, end, consumed)) break;
        end = Math.max(end, change.end);
        b += 1;
        consumed = true;
        grew = true;
      }
    }

    if (start > cursor) parts.push({ items: [...base.slice(cursor, start)] });
    cursor = end;

    const oursTouched = a > firstOurs;
    const theirsTouched = b > firstTheirs;
    const oursSlice = applyIn(base, oursChanges.slice(firstOurs, a), start, end);
    const theirsSlice = applyIn(base, theirsChanges.slice(firstTheirs, b), start, end);

    if (!theirsTouched) {
      parts.push({ items: oursSlice });
      continue;
    }
    if (!oursTouched) {
      parts.push({ items: theirsSlice });
      continue;
    }
    if (sameItems(oursSlice, theirsSlice)) {
      parts.push({ items: oursSlice });
      continue;
    }
    clean = false;
    parts.push({
      conflict: { base: [...base.slice(start, end)], ours: oursSlice, theirs: theirsSlice },
    });
  }

  if (cursor < base.length) parts.push({ items: [...base.slice(cursor)] });
  return { clean, parts };
}

/** Words and the whitespace between them. Joining the result rebuilds the input exactly. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/**
 * A conflict where both people edited the same handful of lines is usually two edits to one
 * sentence. Re-running the merge over words rescues it whenever the words do not overlap.
 */
function refine(conflict: SequenceConflict): string[] | null {
  if (conflict.base.length > REFINE_MAX_LINES) return null;
  if (conflict.ours.length > REFINE_MAX_LINES || conflict.theirs.length > REFINE_MAX_LINES) {
    return null;
  }
  const merged = mergeSequences(
    tokenize(conflict.base.join('\n')),
    tokenize(conflict.ours.join('\n')),
    tokenize(conflict.theirs.join('\n')),
  );
  if (!merged.clean) return null;
  const text = merged.parts.flatMap((part) => ('items' in part ? part.items : [])).join('');
  return text.split('\n');
}

/**
 * Merge two edits of the same text against the version both started from.
 * A conflict is written into the text with the usual `<<<<<<<` markers and also returned
 * structurally, so a UI can show the two sides side by side instead.
 */
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
  labels: MergeLabels = {},
): TextMergeResult {
  if (ours === theirs) return { clean: true, text: ours, conflicts: [] };
  if (base === ours) return { clean: true, text: theirs, conflicts: [] };
  if (base === theirs) return { clean: true, text: ours, conflicts: [] };

  const merged = mergeSequences(base.split('\n'), ours.split('\n'), theirs.split('\n'));
  const oursLabel = labels.ours ?? 'ours';
  const theirsLabel = labels.theirs ?? 'theirs';

  const lines: string[] = [];
  const conflicts: TextConflict[] = [];
  let clean = true;

  for (const part of merged.parts) {
    if ('items' in part) {
      lines.push(...part.items);
      continue;
    }
    const rescued = refine(part.conflict);
    if (rescued !== null) {
      lines.push(...rescued);
      continue;
    }
    clean = false;
    conflicts.push({
      base: part.conflict.base.join('\n'),
      ours: part.conflict.ours.join('\n'),
      theirs: part.conflict.theirs.join('\n'),
    });
    lines.push(`${CONFLICT_START} ${oursLabel}`);
    lines.push(...part.conflict.ours);
    lines.push(CONFLICT_MIDDLE);
    lines.push(...part.conflict.theirs);
    lines.push(`${CONFLICT_END} ${theirsLabel}`);
  }

  return { clean, text: lines.join('\n'), conflicts };
}

/** True when the text still carries unresolved conflict markers. */
export function hasConflictMarkers(text: string): boolean {
  return text.split('\n').some((line) => line.startsWith(CONFLICT_START));
}

// ---------------------------------------------------------------------------
// revisions
// ---------------------------------------------------------------------------

const FNV_PRIME = 0x01000193;

function fnv1a(text: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * A short fingerprint of a page body, used for optimistic concurrency: a save carries the
 * revision it started from, and the server rejects it when the file has moved on.
 *
 * It is two independent FNV-1a hashes plus the length rather than a cryptographic digest,
 * because the browser has no synchronous SHA-256 and this guards against a race, not an
 * attacker. Nothing is decided on the hash alone: a rejected save is merged from the real text.
 */
export function contentRev(markdown: string): string {
  const a = fnv1a(markdown, 0x811c9dc5).toString(36);
  const b = fnv1a(markdown, 0x1000193).toString(36);
  return `${markdown.length.toString(36)}-${a}${b}`;
}
