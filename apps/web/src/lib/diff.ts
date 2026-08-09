/** Line diff for display only. The merge itself lives in @gitdocs/shared. */

export type DiffKind = 'same' | 'add' | 'del';

export interface DiffRow {
  kind: DiffKind;
  text: string;
}

/** Above this the table costs more memory than a readable diff is worth. */
const MAX_CELLS = 4_000_000;

function wholeReplacement(a: string[], b: string[]): DiffRow[] {
  return [
    ...a.map((text): DiffRow => ({ kind: 'del', text })),
    ...b.map((text): DiffRow => ({ kind: 'add', text })),
  ];
}

/** A classic LCS diff. Both texts are one page, so the quadratic table is affordable. */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return wholeReplacement(a, b);

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

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'same', text: a[i] ?? '' });
      i += 1;
      j += 1;
      continue;
    }
    if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
      rows.push({ kind: 'del', text: a[i] ?? '' });
      i += 1;
      continue;
    }
    rows.push({ kind: 'add', text: b[j] ?? '' });
    j += 1;
  }
  while (i < a.length) {
    rows.push({ kind: 'del', text: a[i] ?? '' });
    i += 1;
  }
  while (j < b.length) {
    rows.push({ kind: 'add', text: b[j] ?? '' });
    j += 1;
  }
  return rows;
}

/** Drop long runs of unchanged lines, keeping `context` of them around each change. */
export function collapseUnchanged(rows: DiffRow[], context = 3): Array<DiffRow | 'gap'> {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind === 'same') return;
    for (let at = index - context; at <= index + context; at += 1) {
      if (at >= 0 && at < rows.length) keep.add(at);
    }
  });

  const out: Array<DiffRow | 'gap'> = [];
  let skipping = false;
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      out.push(row);
      skipping = false;
      return;
    }
    if (skipping) return;
    out.push('gap');
    skipping = true;
  });
  return out;
}
