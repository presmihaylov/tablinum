import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBacklinkIndex,
  createPageResolver,
  extractLinks,
  isExternalTarget,
  maskCodeRegions,
  resolveWikilinks,
  type LinkedPage,
} from '../src/links.js';
import type { ContentStore } from '../src/store.js';
import { makeStore, makeTempDir, removeTempDir } from './helpers.js';

const pages: LinkedPage[] = [
  { id: 'pg_A', path: 'eng', title: 'Engineering', hasChildren: true, markdown: '' },
  {
    id: 'pg_B',
    path: 'eng/runbooks',
    title: 'Runbooks',
    hasChildren: true,
    markdown: 'See [[deploy]] and [[eng/rollback|the rollback]].',
  },
  {
    id: 'pg_C',
    path: 'eng/runbooks/deploy',
    title: 'Deploy',
    markdown: 'Back to [runbooks](../runbooks.md) and [[Engineering]].',
  },
  { id: 'pg_D', path: 'eng/rollback', title: 'Rollback', markdown: 'No links here.' },
];

describe('extractLinks', () => {
  it('finds wikilinks with and without an alias', () => {
    const links = extractLinks('a [[foo/bar]] b [[foo/baz|Baz]] c');
    expect(links.map((link) => [link.kind, link.target, link.alias])).toEqual([
      ['wikilink', 'foo/bar', undefined],
      ['wikilink', 'foo/baz', 'Baz'],
    ]);
  });

  it('finds relative markdown links and skips external ones', () => {
    const links = extractLinks(
      '[rel](./sibling.md) [abs](/eng/deploy) [ext](https://example.com) [anchor](#section)',
    );
    expect(links.map((link) => link.target)).toEqual(['./sibling.md', '/eng/deploy']);
  });

  it('skips images and attachment links', () => {
    expect(extractLinks('![shot](./shot.png)')).toHaveLength(0);
    expect(extractLinks('[file](/_assets/pg_A/report.pdf)')).toHaveLength(0);
  });

  it('ignores links inside fenced and inline code', () => {
    const markdown = ['```md', '[[not/a/link]]', '```', '', 'text `[[also/not]]` and [[real/one]]'].join(
      '\n',
    );
    expect(extractLinks(markdown).map((link) => link.target)).toEqual(['real/one']);
  });

  it('reports offsets that point at the original text', () => {
    const markdown = 'prefix [[foo]] suffix';
    const link = extractLinks(markdown)[0];
    expect(markdown.slice(link?.index ?? 0, (link?.index ?? 0) + (link?.length ?? 0))).toBe(
      '[[foo]]',
    );
  });

  it('classifies external targets', () => {
    expect(isExternalTarget('https://example.com')).toBe(true);
    expect(isExternalTarget('mailto:a@b.c')).toBe(true);
    expect(isExternalTarget('#anchor')).toBe(true);
    expect(isExternalTarget('/_assets/x/y.png')).toBe(true);
    expect(isExternalTarget('eng/deploy')).toBe(false);
  });

  it('keeps offsets stable while masking code', () => {
    const markdown = 'a\n```\nb\n```\nc `d` e';
    expect(maskCodeRegions(markdown)).toHaveLength(markdown.length);
  });
});

describe('createPageResolver', () => {
  const resolver = createPageResolver(pages);

  it('resolves an exact path', () => {
    expect(resolver.resolve('eng/runbooks/deploy')?.id).toBe('pg_C');
  });

  it('resolves relative to the page the link sits on', () => {
    expect(resolver.resolve('deploy', { from: 'eng/runbooks' })?.id).toBe('pg_C');
    expect(resolver.resolve('../rollback', { from: 'eng/runbooks/deploy' })?.id).toBe('pg_D');
  });

  it('resolves a unique file name', () => {
    expect(resolver.resolve('rollback')?.id).toBe('pg_D');
  });

  it('resolves a unique title', () => {
    expect(resolver.resolve('Engineering')?.id).toBe('pg_A');
  });

  it('drops the .md extension and any anchor', () => {
    expect(resolver.resolve('eng/rollback.md#step-2')?.id).toBe('pg_D');
  });

  it('returns null for an unknown target', () => {
    expect(resolver.resolve('eng/nowhere')).toBeNull();
  });
});

describe('resolveWikilinks', () => {
  it('rewrites resolved links and keeps unresolved ones', () => {
    const out = resolveWikilinks('[[eng/rollback|Roll back]] and [[nowhere]]', (target) => {
      if (target !== 'eng/rollback') return null;
      return { href: '/eng/rollback', title: 'Rollback' };
    });
    expect(out).toBe('[Roll back](/eng/rollback) and [[nowhere]]');
  });

  it('uses the page title when there is no alias', () => {
    const out = resolveWikilinks('see [[eng/rollback]]', () => ({
      href: '/eng/rollback',
      title: 'Rollback',
    }));
    expect(out).toBe('see [Rollback](/eng/rollback)');
  });

  it('leaves wikilinks inside code alone', () => {
    const markdown = '`[[eng/rollback]]`';
    expect(resolveWikilinks(markdown, () => ({ href: '/x' }))).toBe(markdown);
  });
});

describe('buildBacklinkIndex', () => {
  const index = buildBacklinkIndex(pages);

  it('records who links to a page', () => {
    expect(index.get('pg_C')).toEqual([{ id: 'pg_B', path: 'eng/runbooks', title: 'Runbooks' }]);
    expect(index.get('pg_D')).toEqual([{ id: 'pg_B', path: 'eng/runbooks', title: 'Runbooks' }]);
  });

  it('counts markdown links too', () => {
    expect(index.get('pg_B')).toEqual([
      { id: 'pg_C', path: 'eng/runbooks/deploy', title: 'Deploy' },
    ]);
  });

  it('never records a self link', () => {
    const self: LinkedPage[] = [{ id: 'pg_X', path: 'a/b', title: 'B', markdown: '[[a/b]]' }];
    expect(buildBacklinkIndex(self).get('pg_X')).toBeUndefined();
  });

  it('counts two links from the same page once', () => {
    const twice: LinkedPage[] = [
      { id: 'pg_1', path: 'a/one', title: 'One', markdown: '[[a/two]] then [[a/two|again]]' },
      { id: 'pg_2', path: 'a/two', title: 'Two', markdown: '' },
    ];
    expect(buildBacklinkIndex(twice).get('pg_2')).toHaveLength(1);
  });
});

describe('store link helpers', () => {
  let dir = '';
  let store: ContentStore;

  beforeEach(async () => {
    dir = await makeTempDir();
    store = makeStore(dir);
    await store.init();
    await store.createPage({ path: 'docs/deploy', title: 'Deploy' });
    await store.createPage({
      path: 'docs/rollback',
      title: 'Rollback',
      markdown: 'Undo a [[docs/deploy]].',
    });
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('reports backlinks from the content on disk', async () => {
    const deploy = await store.getPageByPath('docs/deploy');
    const rollback = await store.getPageByPath('docs/rollback');
    expect(await store.getBacklinks(deploy.id)).toEqual([
      { id: rollback.id, path: 'docs/rollback', title: 'Rollback' },
    ]);
  });

  it('rewrites wikilinks into page links', async () => {
    expect(await store.resolveLinks('go to [[deploy]]', 'docs/rollback')).toBe(
      'go to [Deploy](/docs/deploy)',
    );
  });

  it('leaves an unresolvable wikilink alone', async () => {
    expect(await store.resolveLinks('[[docs/ghost]]')).toBe('[[docs/ghost]]');
  });
});
