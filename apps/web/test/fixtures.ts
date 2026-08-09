import { contentRev, type Page, type TreeNode } from '@tablinum/shared';
import type { SpaceTree } from '../src/lib/tree';

let counter = 0;

/** Deterministic, valid page ids: the shared guard rejects anything else. */
export function fakeId(seed?: string): string {
  counter += 1;
  const base = (seed ?? `${counter}`).toUpperCase().replace(/[^0-9ABCDEFGHJKMNPQRSTVWXYZ]/g, '');
  return `pg_${(base + '0'.repeat(26)).slice(0, 26)}`;
}

export function node(path: string, options: Partial<TreeNode> = {}): TreeNode {
  const parts = path.split('/');
  return {
    id: options.id ?? fakeId(parts[parts.length - 1]),
    path,
    title: options.title ?? (parts[parts.length - 1] ?? path),
    children: options.children ?? [],
    ...(options.order === undefined ? {} : { order: options.order }),
    ...(options.icon === undefined ? {} : { icon: options.icon }),
  };
}

export function space(slug: string, tree: TreeNode[]): SpaceTree {
  return { slug, name: slug, tree };
}

export function page(overrides: Partial<Page> = {}): Page {
  const path = overrides.path ?? 'eng/deploy';
  const markdown = overrides.markdown ?? '# Deploy\n';
  return {
    id: overrides.id ?? fakeId('deploy'),
    path,
    space: path.split('/')[0] ?? 'eng',
    title: overrides.title ?? 'Deploy',
    created: overrides.created ?? '2026-01-01T00:00:00.000Z',
    updated: overrides.updated ?? '2026-01-02T00:00:00.000Z',
    markdown,
    rev: overrides.rev ?? contentRev(markdown),
    filePath: overrides.filePath ?? `/content/${path}.md`,
    hasChildren: overrides.hasChildren ?? false,
    ...(overrides.icon === undefined ? {} : { icon: overrides.icon }),
    ...(overrides.order === undefined ? {} : { order: overrides.order }),
  };
}
