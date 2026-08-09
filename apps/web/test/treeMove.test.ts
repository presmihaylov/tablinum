import { describe, expect, it } from 'vitest';
import {
  computeMove,
  computeSpaceMove,
  childPathFor,
  effectiveOrders,
  orderForIndex,
  renamedPath,
} from '../src/lib/treeMove';
import type { SpaceTree } from '../src/lib/tree';
import { node, space } from './fixtures';

/**
 *  eng
 *   ├─ runbooks (order 10)
 *   │   ├─ deploy (order 1)
 *   │   └─ rollback (order 2)
 *   ├─ onboarding (order 20)
 *   └─ faq (order 30)
 */
function tree(): SpaceTree[] {
  return [
    space('eng', [
      node('eng/runbooks', {
        order: 10,
        children: [node('eng/runbooks/deploy', { order: 1 }), node('eng/runbooks/rollback', { order: 2 })],
      }),
      node('eng/onboarding', { order: 20 }),
      node('eng/faq', { order: 30 }),
    ]),
  ];
}

describe('computeMove', () => {
  it('reparents a page into a new parent and sets its path', () => {
    const spaces = tree();
    const patch = computeMove({
      spaces,
      sourcePath: 'eng/faq',
      targetPath: 'eng/runbooks',
      position: 'inside',
    });

    expect(patch).not.toBeNull();
    expect(patch?.body.path).toBe('eng/runbooks/faq');
    // appended after rollback (order 2)
    expect(patch?.body.order).toBe(3);
  });

  it('patches the id of the dragged page, not the target', () => {
    const spaces = tree();
    const source = spaces[0]?.tree[2];
    const patch = computeMove({ spaces, sourcePath: 'eng/faq', targetPath: 'eng/runbooks', position: 'inside' });
    expect(patch?.id).toBe(source?.id);
  });

  it('drops a page before a sibling of another parent', () => {
    const patch = computeMove({
      spaces: tree(),
      sourcePath: 'eng/faq',
      targetPath: 'eng/runbooks/rollback',
      position: 'before',
    });

    expect(patch?.body.path).toBe('eng/runbooks/faq');
    expect(patch?.body.order).toBe(1.5); // between deploy (1) and rollback (2)
  });

  it('reorders inside the same parent without touching the path', () => {
    const patch = computeMove({
      spaces: tree(),
      sourcePath: 'eng/faq',
      targetPath: 'eng/runbooks',
      position: 'before',
    });

    expect(patch?.body.path).toBeUndefined();
    expect(patch?.body.order).toBe(9); // before runbooks (10), nothing above it
  });

  it('renames the slug when the destination already holds that name', () => {
    const spaces = [
      space('eng', [
        node('eng/runbooks', { order: 10, children: [node('eng/runbooks/faq', { order: 1 })] }),
        node('eng/faq', { order: 20 }),
      ]),
    ];

    const patch = computeMove({ spaces, sourcePath: 'eng/faq', targetPath: 'eng/runbooks', position: 'inside' });
    expect(patch?.body.path).toBe('eng/runbooks/faq-2');
  });

  it('refuses to drop a page inside itself or its own subtree', () => {
    const spaces = tree();
    expect(computeMove({ spaces, sourcePath: 'eng/runbooks', targetPath: 'eng/runbooks', position: 'inside' })).toBeNull();
    expect(
      computeMove({ spaces, sourcePath: 'eng/runbooks', targetPath: 'eng/runbooks/deploy', position: 'inside' }),
    ).toBeNull();
    expect(
      computeMove({ spaces, sourcePath: 'eng/runbooks', targetPath: 'eng/runbooks/deploy', position: 'after' }),
    ).toBeNull();
  });

  it('refuses to move a space home page', () => {
    const spaces = [space('eng', [node('eng', { children: [node('eng/faq')] })]), space('ops', [node('ops/oncall')])];
    expect(computeMove({ spaces, sourcePath: 'eng', targetPath: 'ops/oncall', position: 'after' })).toBeNull();
  });

  it('ignores a drop onto an unknown path', () => {
    expect(computeMove({ spaces: tree(), sourcePath: 'eng/faq', targetPath: 'eng/ghost', position: 'inside' })).toBeNull();
  });
});

/** The same eng tree, plus an ops space that holds one page. */
function twoSpaces(): SpaceTree[] {
  return [...tree(), space('ops', [node('ops/oncall', { order: 5 })])];
}

describe('computeSpaceMove', () => {
  it('puts the page at the top level of the other space, after its last page', () => {
    const patch = computeSpaceMove({ spaces: twoSpaces(), sourcePath: 'eng/faq', spaceSlug: 'ops' });
    expect(patch?.body.path).toBe('ops/faq');
    expect(patch?.body.order).toBe(6); // after oncall (5)
  });

  it('patches the id of the page that moves', () => {
    const spaces = twoSpaces();
    const patch = computeSpaceMove({ spaces, sourcePath: 'eng/faq', spaceSlug: 'ops' });
    expect(patch?.id).toBe(spaces[0]?.tree[2]?.id);
  });

  it('keeps the slug of a nested page', () => {
    const patch = computeSpaceMove({
      spaces: twoSpaces(),
      sourcePath: 'eng/runbooks/deploy',
      spaceSlug: 'ops',
    });
    expect(patch?.body.path).toBe('ops/deploy');
  });

  it('renames the slug when the other space already holds that name', () => {
    const spaces = [space('eng', [node('eng/faq')]), space('ops', [node('ops/faq')])];
    const patch = computeSpaceMove({ spaces, sourcePath: 'eng/faq', spaceSlug: 'ops' });
    expect(patch?.body.path).toBe('ops/faq-2');
  });

  it('promotes a nested page to the top level of its own space', () => {
    const patch = computeSpaceMove({
      spaces: twoSpaces(),
      sourcePath: 'eng/runbooks/deploy',
      spaceSlug: 'eng',
    });
    expect(patch?.body.path).toBe('eng/deploy');
    expect(patch?.body.order).toBe(31); // after faq (30)
  });

  it('does nothing when the page already sits at the top of that space', () => {
    expect(computeSpaceMove({ spaces: twoSpaces(), sourcePath: 'eng/faq', spaceSlug: 'eng' })).toBeNull();
  });

  it('refuses to move a space home page', () => {
    const spaces = [space('eng', [node('eng', { children: [node('eng/faq')] })]), space('ops', [node('ops/oncall')])];
    expect(computeSpaceMove({ spaces, sourcePath: 'eng', spaceSlug: 'ops' })).toBeNull();
  });

  it('ignores an unknown space and an unknown page', () => {
    expect(computeSpaceMove({ spaces: twoSpaces(), sourcePath: 'eng/faq', spaceSlug: 'ghost' })).toBeNull();
    expect(computeSpaceMove({ spaces: twoSpaces(), sourcePath: 'eng/ghost', spaceSlug: 'ops' })).toBeNull();
  });
});

describe('order arithmetic', () => {
  it('makes sibling orders strictly increasing even when some are missing', () => {
    const siblings = [node('a/one', { order: 5 }), node('a/two'), node('a/three', { order: 5 })];
    expect(effectiveOrders(siblings)).toEqual([5, 6, 7]);
  });

  it('places a page at either end of a list', () => {
    expect(orderForIndex([10, 20], 0)).toBe(9);
    expect(orderForIndex([10, 20], 2)).toBe(21);
    expect(orderForIndex([], 0)).toBe(0);
  });
});

describe('path helpers', () => {
  it('renames within the current parent', () => {
    expect(renamedPath(tree(), 'eng/faq', 'Frequently Asked')).toBe('eng/frequently-asked');
  });

  it('gives a new child a free slug', () => {
    expect(childPathFor(tree(), 'eng/runbooks', 'Deploy')).toBe('eng/runbooks/deploy-2');
  });
});
