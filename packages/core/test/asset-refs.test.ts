import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PageId } from '@tablinum/shared';
import { silentLogger } from '../src/logger.js';
import { ContentStore, type AssetRefSource } from '../src/store.js';
import { exists, makeTempDir, removeTempDir, tickingClock } from './helpers.js';

/**
 * References the content tree cannot see, on the delete path.
 *
 * deletePage() and deleteSpace() collect the attachments of the pages they removed, so an
 * attachment only a comment shows would go with them. A comment body lives in the account
 * database, which content knows nothing about, so the answer comes from an injected source.
 *
 * A source that cannot answer throws, and a throw keeps every candidate. A private space is
 * never committed, so an attachment deleted out of one is gone for good.
 */

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

/** A source that names the ids it was given back, whenever `held` holds them. */
function holding(held: Set<PageId>, asked: PageId[][] = []): AssetRefSource {
  return (candidates) => {
    asked.push([...candidates]);
    return candidates.filter((id) => held.has(id));
  };
}

function throwing(): AssetRefSource {
  return () => {
    throw new Error('the account database is locked');
  };
}

function makeStore(assetRefs: AssetRefSource): ContentStore {
  return new ContentStore({ contentDir: dir, logger: silentLogger, now: tickingClock(), assetRefs });
}

describe('deletePage and references outside the content tree', () => {
  it('keeps an attachment only the source points at', async () => {
    const held = new Set<PageId>();
    const asked: PageId[][] = [];
    const store = makeStore(holding(held, asked));
    await store.init();

    const plan = await store.createPage({ path: 'docs/plan', title: 'Plan' });
    const saved = await store.saveAsset(plan.id, 'plan.png', new Uint8Array([1]));
    // A comment on a page that survives the delete, quoting the picture.
    await store.createPage({ path: 'docs/notes', title: 'Notes' });
    held.add(plan.id);

    await store.deletePage(plan.id);

    expect(await exists(dir, saved.path)).toBe(true);
    // The source is asked about the page that went, and about nothing else.
    expect(asked).toEqual([[plan.id]]);
  });

  it('still takes an attachment nothing points at', async () => {
    const store = makeStore(holding(new Set()));
    await store.init();

    const plan = await store.createPage({ path: 'docs/plan', title: 'Plan' });
    const saved = await store.saveAsset(plan.id, 'plan.png', new Uint8Array([1]));

    await store.deletePage(plan.id);

    expect(await exists(dir, saved.path)).toBe(false);
  });

  it('keeps every attachment when the source cannot answer', async () => {
    const store = makeStore(throwing());
    await store.init();

    const parent = await store.createPage({ path: 'docs/a', title: 'A' });
    const child = await store.createPage({ path: 'docs/a/b', title: 'B' });
    const first = await store.saveAsset(parent.id, 'parent.png', new Uint8Array([1]));
    const second = await store.saveAsset(child.id, 'child.png', new Uint8Array([2]));

    // The delete itself still finishes: the pages are gone whatever the source said.
    expect(await store.deletePage(parent.id, true)).toEqual(['docs/a', 'docs/a/b']);
    expect(await exists(dir, first.path)).toBe(true);
    expect(await exists(dir, second.path)).toBe(true);
  });
});

describe('deleteSpace and references outside the content tree', () => {
  it('keeps an attachment only the source points at', async () => {
    const held = new Set<PageId>();
    const store = makeStore(holding(held));
    await store.init();

    await store.createSpace('eng', 'Engineering');
    const plan = await store.createPage({ path: 'eng/plan', title: 'Plan' });
    const saved = await store.saveAsset(plan.id, 'plan.png', new Uint8Array([1]));
    held.add(plan.id);

    await store.deleteSpace('eng', true);

    expect(await exists(dir, 'eng/_space.yml')).toBe(false);
    expect(await exists(dir, saved.path)).toBe(true);
  });

  it('still takes an attachment nothing points at', async () => {
    const store = makeStore(holding(new Set()));
    await store.init();

    await store.createSpace('eng', 'Engineering');
    const plan = await store.createPage({ path: 'eng/plan', title: 'Plan' });
    const saved = await store.saveAsset(plan.id, 'plan.png', new Uint8Array([1]));

    await store.deleteSpace('eng', true);

    expect(await exists(dir, saved.path)).toBe(false);
  });

  it('keeps every attachment when the source cannot answer', async () => {
    const store = makeStore(throwing());
    await store.init();

    await store.createSpace('eng', 'Engineering');
    const home = await store.getPageByPath('eng');
    const plan = await store.createPage({ path: 'eng/plan', title: 'Plan' });
    const first = await store.saveAsset(home.id, 'home.png', new Uint8Array([1]));
    const second = await store.saveAsset(plan.id, 'plan.png', new Uint8Array([2]));

    await store.deleteSpace('eng', true);

    expect(await exists(dir, 'eng/_space.yml')).toBe(false);
    expect(await exists(dir, first.path)).toBe(true);
    expect(await exists(dir, second.path)).toBe(true);
  });
});

describe('a store with no source', () => {
  it('reads only page files, as it always did', async () => {
    const store = new ContentStore({ contentDir: dir, logger: silentLogger, now: tickingClock() });
    await store.init();

    const plan = await store.createPage({ path: 'docs/plan', title: 'Plan' });
    const saved = await store.saveAsset(plan.id, 'plan.png', new Uint8Array([1]));

    await store.deletePage(plan.id);

    expect(await exists(dir, saved.path)).toBe(false);
  });
});
