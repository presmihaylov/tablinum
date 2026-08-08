import { FrontmatterSchema, parseOrThrow, validation } from '@gitdocs/shared';
import type { Frontmatter, PropValue } from '@gitdocs/shared';

/**
 * A small YAML codec covering exactly the frontmatter shape the contract defines.
 * It exists so the server test suite owns a real on-disk format without depending on
 * the content store package.
 */

const DELIMITER = '---';

function encodeScalar(value: PropValue): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
  return JSON.stringify(value);
}

export function serializeFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = [DELIMITER];
  lines.push(`id: ${frontmatter.id}`);
  lines.push(`title: ${encodeScalar(frontmatter.title)}`);
  if (frontmatter.icon !== undefined) lines.push(`icon: ${encodeScalar(frontmatter.icon)}`);
  if (frontmatter.tags !== undefined) lines.push(`tags: ${encodeScalar(frontmatter.tags)}`);
  if (frontmatter.order !== undefined) lines.push(`order: ${encodeScalar(frontmatter.order)}`);
  lines.push(`created: ${encodeScalar(frontmatter.created)}`);
  lines.push(`updated: ${encodeScalar(frontmatter.updated)}`);
  const props = frontmatter.props ?? {};
  if (Object.keys(props).length > 0) {
    lines.push('props:');
    for (const [key, value] of Object.entries(props)) {
      lines.push(`  ${key}: ${encodeScalar(value)}`);
    }
  }
  lines.push(DELIMITER, '');
  return lines.join('\n');
}

function decodeScalar(raw: string): PropValue {
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
export function parseFlatYaml(text: string): Record<string, PropValue> {
  const record: Record<string, PropValue> = {};
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const [key, value] = splitKeyValue(trimmed);
    record[key] = decodeScalar(value);
  }
  return record;
}

export function serializeFlatYaml(record: Record<string, PropValue>): string {
  const lines = Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${encodeScalar(value)}`);
  return `${lines.join('\n')}\n`;
}

/** Split a page file into its validated frontmatter and its body. */
export function parsePageFile(raw: string): { frontmatter: Frontmatter; markdown: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== DELIMITER) throw validation('Page file has no frontmatter block');

  const record: Record<string, unknown> = {};
  const props: Record<string, PropValue> = {};
  let inProps = false;
  let end = -1;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === DELIMITER) {
      end = i;
      break;
    }
    if (line.trim().length === 0) continue;

    if (inProps && line.startsWith('  ')) {
      const [key, value] = splitKeyValue(line.trim());
      props[key] = decodeScalar(value);
      continue;
    }

    inProps = false;
    const [key, value] = splitKeyValue(line);
    if (key === 'props' && value.trim().length === 0) {
      inProps = true;
      continue;
    }
    record[key] = decodeScalar(value);
  }

  if (end === -1) throw validation('Page file frontmatter is not terminated');
  if (Object.keys(props).length > 0) record.props = props;

  const frontmatter = parseOrThrow(FrontmatterSchema, record, 'frontmatter');
  return { frontmatter, markdown: lines.slice(end + 1).join('\n') };
}
