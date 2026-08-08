import type { PropValue } from '@gitdocs/shared';

// A plain YAML scalar must not be re-read as a boolean, a number, a date or a structure.
// When any of these patterns match we fall back to a double-quoted scalar, which YAML always
// reads back as the exact string we wrote.
const LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
const BOOL_OR_NULL = /^(y|n|yes|no|true|false|on|off|null|~)$/i;
const DECIMAL = /^[-+]?(\.[0-9_]+|[0-9][0-9_]*(\.[0-9_]*)?)([eE][-+]?[0-9]+)?$/;
const SPECIAL_FLOAT = /^[-+]?\.(inf|nan)$/i;
const RADIX = /^[-+]?0(b[01_]+|o[0-7_]+|x[0-9a-fA-F_]+|[0-7_]+)$/;
const SEXAGESIMAL = /^[-+]?[0-9][0-9_]*(:[0-5]?[0-9])+(\.[0-9_]*)?$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ].*)?$/;
// Inside `[a, b]` a plain scalar may not carry a structure indicator, and readers disagree about
// `:`, `#` and quote characters there. Quote on any of them rather than guess.
const FLOW_UNSAFE = /[,[\]{}:#"'`]/;

const SPACE_CODE = 0x20;
const DEL_CODE = 0x7f;
const LAST_C1_CODE = 0x9f;

/** True for any C0 or C1 control character, including newline and tab. */
export function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < SPACE_CODE) return true;
    if (code >= DEL_CODE && code <= LAST_C1_CODE) return true;
  }
  return false;
}

/** True when a string cannot be written as a plain (unquoted) YAML scalar. */
export function needsQuotes(value: string): boolean {
  if (value.length === 0) return true;
  if (value !== value.trim()) return true;
  if (hasControlChar(value)) return true;
  if (LEADING_INDICATOR.test(value)) return true;
  if (value.includes(': ') || value.endsWith(':')) return true;
  if (value.includes(' #')) return true;
  if (BOOL_OR_NULL.test(value)) return true;
  if (DECIMAL.test(value) || SPECIAL_FLOAT.test(value) || RADIX.test(value)) return true;
  if (SEXAGESIMAL.test(value) || TIMESTAMP.test(value)) return true;
  return false;
}

/**
 * A double-quoted YAML scalar. JSON escaping is a strict subset of YAML's double-quoted
 * escaping, so JSON.stringify produces a scalar that reads back byte for byte.
 */
export function quoteString(value: string): string {
  return JSON.stringify(value);
}

export function emitString(value: string): string {
  if (needsQuotes(value)) return quoteString(value);
  return value;
}

/** Same as emitString, but also quotes what would break a `[a, b]` flow sequence. */
export function emitFlowString(value: string): string {
  if (needsQuotes(value) || FLOW_UNSAFE.test(value)) return quoteString(value);
  return value;
}

export function emitNumber(value: number): string {
  if (Number.isNaN(value)) return '.nan';
  if (value === Number.POSITIVE_INFINITY) return '.inf';
  if (value === Number.NEGATIVE_INFINITY) return '-.inf';
  return String(value);
}

export function emitKey(key: string): string {
  if (needsQuotes(key) || key.includes(':') || key.includes(' ')) return quoteString(key);
  return key;
}

export function emitFlowSequence(items: readonly string[]): string {
  return `[${items.map(emitFlowString).join(', ')}]`;
}

/** Write an ISO timestamp plainly; YAML reads it back as a date and we re-normalize on parse. */
export function emitTimestamp(iso: string): string {
  if (TIMESTAMP.test(iso) && !hasControlChar(iso)) return iso;
  return quoteString(iso);
}

export function emitPropValue(value: PropValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return emitNumber(value);
  if (Array.isArray(value)) return emitFlowSequence(value);
  return emitString(value);
}
