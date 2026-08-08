import type { PropValue } from '@gitdocs/shared';

/** Editing affordance chosen for a frontmatter property. */
export type PropType = 'text' | 'number' | 'boolean' | 'date' | 'multi';

export const PROP_TYPES: readonly PropType[] = ['text', 'number', 'boolean', 'date', 'multi'];

export const PROP_TYPE_LABELS: Record<PropType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Checkbox',
  date: 'Date',
  multi: 'Multi-select',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function isDateLike(raw: string): boolean {
  const trimmed = raw.trim();
  if (!DATE_RE.test(trimmed)) return false;
  return !Number.isNaN(Date.parse(trimmed));
}

function isNumberLike(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  return Number.isFinite(Number(trimmed));
}

/** Type of a value already stored in frontmatter. */
export function inferPropType(value: PropValue): PropType {
  if (Array.isArray(value)) return 'multi';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && isDateLike(value)) return 'date';
  return 'text';
}

/** Type guessed from what the user just typed into an untyped cell. */
export function inferTypeFromInput(raw: string): PropType {
  const trimmed = raw.trim();
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (isDateLike(trimmed)) return 'date';
  if (isNumberLike(trimmed)) return 'number';
  if (trimmed.includes(',')) return 'multi';
  return 'text';
}

/** Turn raw cell text into the stored value for a given type. */
export function coercePropValue(raw: string, type: PropType): PropValue {
  const trimmed = raw.trim();
  if (type === 'multi') {
    const items = trimmed
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items;
  }
  if (trimmed.length === 0) return null;
  if (type === 'boolean') return trimmed === 'true' || trimmed === '1' || trimmed === 'yes';
  if (type === 'number') {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  return trimmed;
}

/** Parse a cell with no declared type: guess the type, then coerce. */
export function parsePropInput(raw: string): PropValue {
  return coercePropValue(raw, inferTypeFromInput(raw));
}

/** Render a stored value back into editable text. */
export function formatPropValue(value: PropValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Re-type an existing value when the user switches a row's type. */
export function convertPropValue(value: PropValue, type: PropType): PropValue {
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.length > 0;
    return formatPropValue(value).trim().toLowerCase() === 'true';
  }
  return coercePropValue(formatPropValue(value), type);
}
