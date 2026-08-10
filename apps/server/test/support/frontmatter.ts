import { validation } from '@tablinum/shared';
import { parse, stringifyFrontmatter } from '@tablinum/core';
import type { Frontmatter } from '@tablinum/shared';

/** Every value this codec can write. `_space.yml` needs no more than these. */
export type Scalar = string | number | boolean | null | string[];

/** A small YAML codec for the flat `key: value` documents `_space.yml` is written in. */

const DELIMITER = '---';

function encodeScalar(value: Scalar): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
  return JSON.stringify(value);
}

/**
 * The block a page file opens with. A database carries nested YAML that this file's flat codec
 * cannot write, so the real emitter does the work and the codec below stays for `_space.yml`.
 */
export function serializeFrontmatter(frontmatter: Frontmatter): string {
  return `${DELIMITER}\n${stringifyFrontmatter(frontmatter)}\n${DELIMITER}\n`;
}

function decodeScalar(raw: string): Scalar {
  const text = raw.trim();
  if (text.length === 0 || text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(',').map((item) => String(decodeScalar(item) ?? ''));
  }
  if (text.startsWith('"')) {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'string' ? parsed : String(parsed);
  }
  const asNumber = Number(text);
  if (text !== '' && !Number.isNaN(asNumber) && /^-?\d+(\.\d+)?$/.test(text)) return asNumber;
  return text;
}

function splitKeyValue(line: string): [string, string] {
  const at = line.indexOf(':');
  if (at <= 0) throw validation(`Malformed frontmatter line: ${JSON.stringify(line)}`);
  return [line.slice(0, at).trim(), line.slice(at + 1)];
}

/** Read a flat `key: value` document, used for `_space.yml`. */
export function parseFlatYaml(text: string): Record<string, Scalar> {
  const record: Record<string, Scalar> = {};
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const [key, value] = splitKeyValue(trimmed);
    record[key] = decodeScalar(value);
  }
  return record;
}

export function serializeFlatYaml(record: Record<string, Scalar>): string {
  const lines = Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${encodeScalar(value)}`);
  return `${lines.join('\n')}\n`;
}

/** Split a page file into its validated frontmatter and its body. */
export function parsePageFile(raw: string): { frontmatter: Frontmatter; markdown: string } {
  const parsed = parse(raw);
  if (parsed.blockBroken) throw validation('Page file frontmatter is not terminated');
  if (!raw.replace(/\r\n/g, '\n').startsWith(DELIMITER)) {
    throw validation('Page file has no frontmatter block');
  }
  return { frontmatter: parsed.frontmatter, markdown: parsed.body };
}
