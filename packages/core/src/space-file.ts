import { parse as parseYaml } from 'yaml';
import { SpaceFileSchema, type Space } from '@tablinum/shared';
import { emitNumber, emitString } from './yaml-emit.js';
import { titleize } from './frontmatter.js';

/** Read a `_space.yml`. A missing or broken file falls back to a name derived from the slug. */
export function parseSpaceFile(text: string | null, slug: string): Space {
  const fallback: Space = { slug, name: titleize(slug) };
  if (text === null) return fallback;
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch {
    return fallback;
  }
  const parsed = SpaceFileSchema.safeParse(data);
  if (!parsed.success) return fallback;
  const space: Space = { slug, name: parsed.data.name };
  if (parsed.data.icon !== undefined) space.icon = parsed.data.icon;
  if (parsed.data.order !== undefined) space.order = parsed.data.order;
  if (parsed.data.owner !== undefined) space.owner = parsed.data.owner;
  return space;
}

/** Write a `_space.yml` in a fixed key order so the file never churns. */
export function serializeSpaceFile(space: Space): string {
  const lines = [`name: ${emitString(space.name)}`];
  if (space.icon !== undefined && space.icon !== null && space.icon.length > 0) {
    lines.push(`icon: ${JSON.stringify(space.icon)}`);
  }
  if (space.order !== undefined && space.order !== null) {
    lines.push(`order: ${emitNumber(space.order)}`);
  }
  if (space.owner !== undefined && space.owner !== null && space.owner.length > 0) {
    lines.push(`owner: ${emitString(space.owner)}`);
  }
  return `${lines.join('\n')}\n`;
}
