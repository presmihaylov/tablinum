import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newPageId, type Frontmatter } from '@tablinum/shared';
import type { ServerDeps } from '../src/deps.js';
import {
  RecentWrites,
  Wiring,
  contentRelPath,
  pageFileVariants,
  startContentWatcher,
  type ContentWatcher,
} from '../src/wiring.js';
import { serializeFrontmatter } from './support/frontmatter.js';
import { makeHarness, seed, type Harness } from './support/harness.js';
import { waitFor } from './support/wait.js';

describe('RecentWrites', () => {
  it('remembers a path until its ttl expires', () => {
    const writes = new RecentWrites(1000);
    writes.mark('eng/deploy.md', 0);

    expect(writes.has('eng/deploy.md', 500)).toBe(true);
    expect(writes.has('eng/deploy.md', 1000)).toBe(false);
    expect(writes.has('eng/other.md', 500)).toBe(false);
  });

  it('drops expired entries on prune', () => {
    const writes = new RecentWrites(100);
    writes.markAll(['a.md', 'b.md'], 0);
    expect(writes.size).toBe(2);

    writes.prune(50);
    expect(writes.size).toBe(2);

    writes.prune(200);
    expect(writes.size).toBe(0);
  });
});

describe('pageFileVariants', () => {
  it('covers the leaf file and the index file of a path', () => {
    expect(pageFileVariants('eng/deploy')).toEqual(['eng/deploy.md', 'eng/deploy/index.md']);
  });
});

describe('contentRelPath', () => {
  it('returns a slash separated path relative to the content root', () => {
    expect(contentRelPath('/data/content', '/data/content/eng/deploy.md')).toBe('eng/deploy.md');
  });
});

describe('content watcher', () => {
  let harness: Harness;
  let watcher: ContentWatcher;
  let wiring: Wiring;
  let scheduled: number;
  let oncallId: string;

  function pageFile(title: string, body: string, id = newPageId()): string {
    const now = new Date().toISOString();
    const frontmatter: Frontmatter = { id, title, created: now, updated: now };
    return serializeFrontmatter(frontmatter) + body;
  }

  beforeEach(async () => {
    harness = await makeHarness();
    const seeded = await seed(harness);
    oncallId = seeded.pageIds[1] ?? '';

    scheduled = 0;
    harness.git.scheduleCommit = (): void => {
      scheduled += 1;
    };

    // A separate Wiring, because the watcher must be driven from the test, not from a route.
    const deps: ServerDeps = { ...harness.deps, echoSuppressMs: 5000 };
    wiring = new Wiring(deps, harness.app.log);
    watcher = startContentWatcher(deps, wiring, harness.app.log);
    await watcher.whenReady();
  });

  afterEach(async () => {
    await watcher.close();
    await harness.close();
  });

  it('indexes a markdown file written outside the api and schedules a commit', async () => {
    const before = harness.search.size;
    await writeFile(
      join(harness.contentDir, 'eng/manual.md'),
      pageFile('Manual edit', 'This page mentions zebras.'),
      'utf8',
    );

    await waitFor(() => harness.search.size === before + 1, 'the new page to be indexed');
    const hits = await harness.search.search('zebras');
    expect(hits.map((hit) => hit.path)).toEqual(['eng/manual']);
    expect(scheduled).toBeGreaterThan(0);
  });

  it('re-indexes an out-of-band change to an existing file', async () => {
    const before = harness.search.size;
    await writeFile(
      join(harness.contentDir, 'eng/oncall.md'),
      pageFile('On-call guide', 'Now it mentions walrus instead.', oncallId),
      'utf8',
    );

    await waitFor(async () => {
      const hits = await harness.search.search('walrus');
      return hits.length === 1;
    }, 'the changed page to be re-indexed');
    expect(harness.search.size).toBe(before);
  });

  it('removes a page from the index when its file disappears', async () => {
    const before = harness.search.size;
    await rm(join(harness.contentDir, 'eng/oncall.md'));

    await waitFor(() => harness.search.size === before - 1, 'the deleted page to leave the index');
  });

  it('ignores the echo of a write the api already recorded', async () => {
    const before = harness.search.size;
    wiring.markWritten(['eng/echo.md']);
    await writeFile(
      join(harness.contentDir, 'eng/echo.md'),
      pageFile('Echo', 'Written through the api.'),
      'utf8',
    );

    // A file that was not marked proves the watcher is still awake.
    await writeFile(
      join(harness.contentDir, 'eng/live.md'),
      pageFile('Live', 'Written by hand.'),
      'utf8',
    );
    await waitFor(() => harness.search.size === before + 1, 'the unmarked page to be indexed');
    await watcher.drain();

    expect(harness.search.size).toBe(before + 1);
    const echoes = await harness.search.search('echo');
    expect(echoes).toHaveLength(0);
  });
});
