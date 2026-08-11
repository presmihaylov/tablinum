import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SearchHitSchema, findMentions } from '@tablinum/shared';
import { SEARCH_DB_FILENAME, SearchIndex, defaultDbPath } from '../src/index.js';
import type { IndexablePage } from '../src/index.js';
import { page, tempDb, type TempDb } from './helpers.js';

describe('SearchIndex', () => {
  let db: TempDb;
  let index: SearchIndex;

  beforeEach(() => {
    db = tempDb();
    index = new SearchIndex({ dbPath: db.dbPath });
    index.init();
  });

  afterEach(() => {
    index.close();
    db.cleanup();
  });

  // -------------------------------------------------------------------------
  // schema
  // -------------------------------------------------------------------------

  it('creates the database file and its parent directory', () => {
    expect(existsSync(db.dbPath)).toBe(true);
    expect(index.count()).toBe(0);
  });

  it('is safe to init twice', () => {
    expect(() => {
      index.init();
      index.init();
    }).not.toThrow();
    expect(index.count()).toBe(0);
  });

  it('puts the default index beside the content directory, not inside it', () => {
    expect(defaultDbPath('/srv/tablinum/content')).toBe(`/srv/tablinum/${SEARCH_DB_FILENAME}`);
    expect(defaultDbPath('/srv/tablinum/content')).not.toContain('/content/');
  });

  // -------------------------------------------------------------------------
  // index then find
  // -------------------------------------------------------------------------

  it('finds a page by a word in its body', async () => {
    const target = page({
      path: 'eng/rollout',
      title: 'Rollout guide',
      markdown: 'We ship the service to the cluster with a canary stage first.',
    });
    index.upsert(target);
    index.upsert(page({ path: 'eng/holidays', title: 'Holidays', markdown: 'Nothing to see.' }));

    const hits = await index.search('canary');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe(target.id);
    expect(hits[0]?.path).toBe('eng/rollout');
    expect(hits[0]?.title).toBe('Rollout guide');
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('returns hits the REST layer can serialise unchanged', async () => {
    index.upsert(
      page({
        path: 'eng/runbooks/deploy',
        title: 'Deploy runbook',
        markdown: 'The canary stage watches error rates.',
      }),
    );

    const hits = await index.search('canary');
    expect(hits).toHaveLength(1);
    for (const hit of hits) expect(() => SearchHitSchema.parse(hit)).not.toThrow();
    expect(Object.keys(hits[0] ?? {}).sort()).toEqual([
      'id',
      'path',
      'score',
      'snippet',
      'title',
    ]);
  });

  it('finds a page by a word in its title', async () => {
    const target = page({ path: 'eng/alpha', title: 'Postgres tuning', markdown: 'Body text.' });
    index.upsert(target);

    const hits = await index.search('postgres');
    expect(hits.map((hit) => hit.id)).toEqual([target.id]);
  });

  it('ANDs the terms of a multi-word query', async () => {
    const both = page({
      path: 'eng/alpha',
      title: 'Alpha',
      markdown: 'The backup job restores the cluster from cold storage.',
    });
    index.upsert(both);
    index.upsert(
      page({ path: 'eng/beta', title: 'Beta', markdown: 'The backup job runs nightly.' }),
    );

    const hits = await index.search('backup restores');
    expect(hits.map((hit) => hit.id)).toEqual([both.id]);
  });

  it('matches a quoted phrase in order', async () => {
    const inOrder = page({
      path: 'eng/alpha',
      title: 'Alpha',
      markdown: 'Follow the incident response checklist.',
    });
    index.upsert(inOrder);
    index.upsert(
      page({
        path: 'eng/beta',
        title: 'Beta',
        markdown: 'The response was slow and the incident stayed open.',
      }),
    );

    const hits = await index.search('"incident response"');
    expect(hits.map((hit) => hit.id)).toEqual([inOrder.id]);
  });

  it('indexes the words of the page path', async () => {
    const target = page({ path: 'eng/runbooks/database', title: 'Untitled', markdown: 'text' });
    index.upsert(target);

    const hits = await index.search('runbooks');
    expect(hits.map((hit) => hit.id)).toEqual([target.id]);
  });

  // -------------------------------------------------------------------------
  // column filter
  // -------------------------------------------------------------------------

  describe('fields', () => {
    const NAME_ONLY = ['title', 'path'] as const;

    beforeEach(() => {
      index.upsert(
        page({
          id: 'pg_runbook',
          path: 'eng/deploy-runbook',
          title: 'Deploy runbook',
          markdown: 'We roll out with zebracoffee tooling. Rollback is documented elsewhere.',
        }),
      );
      index.upsert(
        page({ id: 'pg_rollback', path: 'eng/rollback', title: 'Rollback', markdown: 'Undo it.' }),
      );
    });

    // The reported bug: "zebracoffee" names no page, and full text answered with one anyway.
    it('drops a page that only mentions the word in its body', async () => {
      expect((await index.search('zebracoffee')).map((hit) => hit.title)).toEqual([
        'Deploy runbook',
      ]);
      expect(await index.search('zebracoffee', { fields: NAME_ONLY })).toEqual([]);
    });

    it('still answers on a prefix of the title', async () => {
      const hits = await index.search('depl', { fields: NAME_ONLY });
      expect(hits.map((hit) => hit.title)).toEqual(['Deploy runbook']);
    });

    it('still answers on every word of a multi-word name', async () => {
      const hits = await index.search('deploy run', { fields: NAME_ONLY });
      expect(hits.map((hit) => hit.title)).toEqual(['Deploy runbook']);
    });

    it('still answers on a word of the path', async () => {
      const hits = await index.search('eng', { fields: NAME_ONLY });
      expect(hits.map((hit) => hit.title).sort()).toEqual(['Deploy runbook', 'Rollback']);
    });

    it('drops the path when the title alone is asked for', async () => {
      expect(await index.search('eng', { fields: ['title'] })).toEqual([]);
      expect((await index.search('rollback', { fields: ['title'] })).map((hit) => hit.title)).toEqual(
        ['Rollback'],
      );
    });

    it('names every column, which is the same as naming none', async () => {
      const every = await index.search('zebracoffee', { fields: ['title', 'body', 'path'] });
      expect(every.map((hit) => hit.title)).toEqual(['Deploy runbook']);
    });

    it('does not throw on hostile input inside a column filter', async () => {
      for (const query of ['*', '"', 'NEAR(', 'a" OR "b', '{body}:x']) {
        await expect(index.search(query, { fields: NAME_ONLY })).resolves.toBeInstanceOf(Array);
      }
    });
  });

  // -------------------------------------------------------------------------
  // icons
  // -------------------------------------------------------------------------

  it('returns the icon of a page, and omits the field when it has none', async () => {
    index.upsert(page({ id: 'pg_a', path: 'eng/alpha', title: 'Alpha', icon: '🐙' }));
    index.upsert(page({ id: 'pg_b', path: 'eng/beta', title: 'Beta' }));

    const alpha = await index.search('alpha');
    expect(alpha[0]?.icon).toBe('🐙');

    const beta = await index.search('beta');
    expect(beta[0]).not.toHaveProperty('icon');
  });

  it('follows the icon when a page is re-indexed', async () => {
    const first = page({ id: 'pg_a', path: 'eng/alpha', title: 'Alpha', icon: '🐙' });
    index.upsert(first);
    index.upsert({ ...first, icon: ':party:' });

    expect((await index.search('alpha'))[0]?.icon).toBe(':party:');

    index.upsert({ ...first, icon: undefined });
    expect((await index.search('alpha'))[0]).not.toHaveProperty('icon');
  });

  // -------------------------------------------------------------------------
  // ranking
  // -------------------------------------------------------------------------

  // The title-matching page is deliberately the LONGER document. bm25 favours short
  // documents, so only the title weight can put it first.
  it('ranks a title match above a body-only match', async () => {
    const titled = page({
      path: 'eng/alpha',
      title: 'Widget handbook',
      markdown: 'This document explains the internal tooling that the team follows every day.',
    });
    const bodyOnly = page({
      path: 'eng/beta',
      title: 'Internal notes',
      markdown: 'A widget.',
    });
    index.upsert(bodyOnly);
    index.upsert(titled);

    const hits = await index.search('widget');
    expect(hits).toHaveLength(2);
    expect(hits[0]?.id).toBe(titled.id);
    expect(hits[1]?.id).toBe(bodyOnly.id);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it('returns hits ordered by descending score', async () => {
    for (let n = 0; n < 5; n += 1) {
      index.upsert(
        page({
          path: `eng/page-${n}`,
          title: n === 2 ? 'Metrics dashboard' : `Page ${n}`,
          markdown: 'The metrics pipeline collects samples once a minute.',
        }),
      );
    }

    const hits = await index.search('metrics');
    const scores = hits.map((hit) => hit.score);
    expect(scores.length).toBeGreaterThan(1);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  // -------------------------------------------------------------------------
  // filters
  // -------------------------------------------------------------------------

  it('filters by space', async () => {
    const eng = page({ path: 'eng/alpha', markdown: 'shared vocabulary term glossary' });
    const ops = page({ path: 'ops/alpha', markdown: 'shared vocabulary term glossary' });
    index.upsert(eng);
    index.upsert(ops);

    expect((await index.search('glossary')).map((hit) => hit.id).sort()).toEqual(
      [eng.id, ops.id].sort(),
    );
    expect((await index.search('glossary', { space: 'ops' })).map((hit) => hit.id)).toEqual([
      ops.id,
    ]);
    expect(await index.search('glossary', { space: 'marketing' })).toEqual([]);
  });

  it('honours the limit and clamps it to a sane range', async () => {
    for (let n = 0; n < 8; n += 1) {
      index.upsert(page({ path: `eng/page-${n}`, markdown: 'glossary of shared terms' }));
    }

    expect(await index.search('glossary', { limit: 3 })).toHaveLength(3);
    expect(await index.search('glossary', { limit: 0 })).toHaveLength(1);
    expect(await index.search('glossary', { limit: -5 })).toHaveLength(1);
    expect(await index.search('glossary', { limit: 10_000 })).toHaveLength(8);
    expect(await index.search('glossary')).toHaveLength(8);
  });

  // -------------------------------------------------------------------------
  // prefix fallback
  // -------------------------------------------------------------------------

  it('falls back to a prefix match on the last token', async () => {
    const target = page({
      path: 'eng/deploy',
      title: 'Deploy runbook',
      markdown: 'Run the deploy script from the bastion host.',
    });
    index.upsert(target);

    expect((await index.search('depl')).map((hit) => hit.id)).toEqual([target.id]);
    expect((await index.search('deplo')).map((hit) => hit.id)).toEqual([target.id]);
    expect((await index.search('deploy')).map((hit) => hit.id)).toEqual([target.id]);
  });

  it('applies the prefix to the last token of a multi-token query', async () => {
    const target = page({
      path: 'eng/alpha',
      title: 'Alpha',
      markdown: 'The bastion host runs the deployment pipeline.',
    });
    index.upsert(target);

    expect((await index.search('bastion deplo')).map((hit) => hit.id)).toEqual([target.id]);
  });

  it('prefers an exact match over the prefix fallback', async () => {
    const exact = page({ path: 'eng/alpha', title: 'Alpha', markdown: 'The cat sat down.' });
    index.upsert(exact);
    index.upsert(page({ path: 'eng/beta', title: 'Beta', markdown: 'The catalogue is long.' }));

    const hits = await index.search('cat');
    expect(hits.map((hit) => hit.id)).toEqual([exact.id]);
  });

  // -------------------------------------------------------------------------
  // snippets
  // -------------------------------------------------------------------------

  it('marks the matched term in the snippet', async () => {
    index.upsert(
      page({
        path: 'eng/alpha',
        title: 'Alpha',
        markdown:
          'The scheduler drains a node before it reboots. Draining moves every pod elsewhere.',
      }),
    );

    const hits = await index.search('scheduler');
    expect(hits[0]?.snippet).toContain('<mark>');
    expect(hits[0]?.snippet).toContain('</mark>');
    expect(hits[0]?.snippet.toLowerCase()).toContain('<mark>scheduler</mark>');
  });

  it('HTML-escapes page content inside the snippet', async () => {
    index.upsert(
      page({
        path: 'eng/alpha',
        title: 'Alpha',
        markdown: 'The parser rejects a raw ampersand & a quote " in xmlmarker input.',
      }),
    );

    const hits = await index.search('xmlmarker');
    const snippet = hits[0]?.snippet ?? '';
    expect(snippet).toContain('&amp;');
    expect(snippet).toContain('&quot;');
    expect(snippet).not.toMatch(/<(?!\/?mark>)/);
  });

  it('never emits a script tag from page content', async () => {
    index.upsert(
      page({
        path: 'eng/alpha',
        title: 'Alpha',
        markdown: 'Sanitising input matters: <img src=x onerror=alert(1)> stays inert.',
      }),
    );

    const hits = await index.search('sanitising');
    expect(hits[0]?.snippet).not.toContain('<img');
    expect(hits[0]?.snippet).not.toContain('onerror');
  });

  it('falls back to the title when the body holds no text', async () => {
    index.upsert(page({ path: 'eng/alpha', title: 'Empty page', markdown: '' }));

    const hits = await index.search('empty');
    expect(hits[0]?.snippet).toBe('Empty page');
  });

  it('returns the snippet as a single line', async () => {
    index.upsert(
      page({
        path: 'eng/alpha',
        title: 'Alpha',
        markdown: 'First paragraph mentions the beacon.\n\nSecond paragraph continues after it.',
      }),
    );

    const snippet = (await index.search('beacon'))[0]?.snippet ?? '';
    expect(snippet).not.toMatch(/\s{2}|\n/);
    expect(snippet).toContain('<mark>beacon</mark>');
    expect(snippet).toContain('Second paragraph');
  });

  it('indexes prose, not markdown syntax', async () => {
    index.upsert(
      page({
        path: 'eng/alpha',
        title: 'Alpha',
        markdown: '# Heading\n\nSee [the runbook](https://example.com/runbook) for details.\n',
      }),
    );

    const hits = await index.search('runbook');
    expect(hits[0]?.snippet).not.toContain('https');
    expect(hits[0]?.snippet).not.toContain('](');
  });

  // -------------------------------------------------------------------------
  // upsert and removal
  // -------------------------------------------------------------------------

  it('replaces the indexed body when a page is re-indexed', async () => {
    const target = page({ path: 'eng/alpha', title: 'Alpha', markdown: 'obsoleteword lives here' });
    index.upsert(target);
    expect(await index.search('obsoleteword')).toHaveLength(1);

    index.upsert({ ...target, markdown: 'freshword lives here', title: 'Alpha renamed' });

    expect(await index.search('obsoleteword')).toEqual([]);
    expect((await index.search('freshword')).map((hit) => hit.id)).toEqual([target.id]);
    expect((await index.search('freshword'))[0]?.title).toBe('Alpha renamed');
    expect(index.count()).toBe(1);
  });

  it('follows a page to its new path without duplicating it', async () => {
    const target = page({ path: 'eng/alpha', title: 'Alpha', markdown: 'unique marker word' });
    index.upsert(target);
    index.upsert({ ...target, path: 'ops/alpha', space: 'ops' });

    const hits = await index.search('marker');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('ops/alpha');
    expect(await index.search('marker', { space: 'eng' })).toEqual([]);
  });

  it('removes a page from the index', async () => {
    const target = page({ path: 'eng/alpha', markdown: 'unique marker word' });
    index.upsert(target);
    expect(await index.search('marker')).toHaveLength(1);

    expect(index.remove(target.id)).toBe(true);
    expect(await index.search('marker')).toEqual([]);
    expect(index.count()).toBe(0);
    // An orphan pages_fts row would be invisible to search but would still leak.
    expect(index.stats()).toEqual({ pages: 0, indexed: 0 });
    expect(index.remove(target.id)).toBe(false);
  });

  it('removes a whole subtree', async () => {
    const parent = page({ path: 'eng/runbooks', markdown: 'unique marker word' });
    const child = page({ path: 'eng/runbooks/deploy', markdown: 'unique marker word' });
    const sibling = page({ path: 'eng/runbooks-archive', markdown: 'unique marker word' });
    index.upsertMany([parent, child, sibling]);

    const removed = index.removeSubtree('eng/runbooks');
    expect(removed.sort()).toEqual([parent.id, child.id].sort());
    expect((await index.search('marker')).map((hit) => hit.id)).toEqual([sibling.id]);
    expect(index.stats()).toEqual({ pages: 1, indexed: 1 });
  });

  it('clears every row but keeps the schema', async () => {
    index.upsertMany([page({ path: 'eng/alpha', markdown: 'marker' })]);
    index.clear();
    expect(index.count()).toBe(0);
    expect(await index.search('marker')).toEqual([]);
    expect(index.stats()).toEqual({ pages: 0, indexed: 0 });
  });

  it('keeps the two tables in step through a churn of writes', async () => {
    const pages = [0, 1, 2, 3].map((n) =>
      page({ path: `eng/page-${n}`, markdown: `body ${n} marker` }),
    );
    index.upsertMany(pages);
    expect(index.stats()).toEqual({ pages: 4, indexed: 4 });

    index.upsert({ ...pages[0]!, markdown: 'rewritten marker' });
    index.remove(pages[1]!.id);
    index.upsert(page({ path: 'eng/page-9', markdown: 'new marker' }));
    index.removeSubtree('eng/page-2');

    const stats = index.stats();
    expect(stats.pages).toBe(stats.indexed);
    expect(stats.pages).toBe(index.count());
    expect(await index.search('marker')).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // reindexAll
  // -------------------------------------------------------------------------

  it('rebuilds the index from scratch and drops stale pages', async () => {
    const stale = page({ path: 'eng/stale', markdown: 'obsoleteword content' });
    index.upsert(stale);

    const fresh = [
      page({ path: 'eng/one', title: 'One', markdown: 'freshword content' }),
      page({ path: 'eng/two', title: 'Two', markdown: 'freshword content' }),
    ];
    expect(index.reindexAll(fresh)).toBe(2);

    expect(index.count()).toBe(2);
    expect(await index.search('obsoleteword')).toEqual([]);
    expect(await index.search('freshword')).toHaveLength(2);
    expect(index.listIds().sort()).toEqual(fresh.map((one) => one.id).sort());
  });

  it('accepts an empty rebuild', () => {
    index.upsert(page({ path: 'eng/alpha', markdown: 'marker' }));
    expect(index.reindexAll([])).toBe(0);
    expect(index.count()).toBe(0);
  });

  it('leaves the index untouched when the page source throws', async () => {
    const good = page({ path: 'eng/alpha', markdown: 'stableword content' });
    index.upsert(good);

    function* broken(): Generator<IndexablePage> {
      yield page({ path: 'eng/beta', markdown: 'newword content' });
      throw new Error('reader blew up');
    }

    expect(() => index.reindexAll(broken())).toThrow('reader blew up');
    expect((await index.search('stableword')).map((hit) => hit.id)).toEqual([good.id]);
    expect(await index.search('newword')).toEqual([]);
  });

  // The failure must happen while rows are being written, so only a rollback can
  // restore the previous contents.
  it('rolls back a rebuild that fails part way through the writes', async () => {
    const good = page({ path: 'eng/alpha', markdown: 'stableword content' });
    index.upsert(good);

    const exploding: IndexablePage = {
      ...page({ path: 'eng/gamma' }),
      get markdown(): string {
        throw new Error('page read blew up');
      },
    };
    const batch = [page({ path: 'eng/beta', markdown: 'newword content' }), exploding];

    expect(() => index.reindexAll(batch)).toThrow('page read blew up');
    expect(index.count()).toBe(1);
    expect(index.stats()).toEqual({ pages: 1, indexed: 1 });
    expect((await index.search('stableword')).map((hit) => hit.id)).toEqual([good.id]);
    expect(await index.search('newword')).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // hostile input
  // -------------------------------------------------------------------------

  it('returns an empty list for a query with no usable term', async () => {
    for (const query of ['', '   ', '*', '***', '-', '()', '^', '""', '   " "  ', '+']) {
      await expect(index.search(query)).resolves.toEqual([]);
    }
  });

  it('does not throw on hostile FTS5 input', async () => {
    index.upsert(
      page({ path: 'eng/alpha', title: 'Alpha', markdown: 'foo bar baz near and or not' }),
    );

    const hostile = [
      'foo" OR "',
      '*',
      'NEAR(',
      'NEAR(foo bar, 3)',
      'foo AND',
      'AND OR NOT',
      'foo OR',
      '"unterminated',
      'a AND (b OR c',
      'foo:bar',
      'col:*',
      '^foo',
      'foo -bar',
      'foo NEAR bar',
      '(((((',
      ')))))',
      '"""""',
      '\\',
      '%_',
      'foo*bar*',
      "'; DROP TABLE pages; --",
      'a'.repeat(5000),
    ];

    for (const query of hostile) {
      await expect(index.search(query)).resolves.toBeInstanceOf(Array);
    }
  });

  it('treats FTS5 operator words as ordinary terms', async () => {
    const target = page({ path: 'eng/alpha', title: 'Alpha', markdown: 'near and or not here' });
    index.upsert(target);

    expect((await index.search('near')).map((hit) => hit.id)).toEqual([target.id]);
    expect((await index.search('NEAR(')).map((hit) => hit.id)).toEqual([target.id]);
    expect((await index.search('and or not')).map((hit) => hit.id)).toEqual([target.id]);
  });

  it('does not let a hostile query delete rows', async () => {
    index.upsert(page({ path: 'eng/alpha', markdown: 'marker' }));
    await index.search("'; DELETE FROM pages; --");
    expect(index.count()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // handles
  // -------------------------------------------------------------------------

  // Why a handle rename counts the pages it will rewrite by reading them, and not by asking
  // this index for a shortlist first. The index answers a handle query, but it answers with
  // less than the truth, and the count is what a person agrees to before the rewrite.

  it('drops the @ of a handle, so a handle query is no more selective than the bare word', async () => {
    const mention = page({ path: 'eng/alpha', title: 'Alpha', markdown: 'Ask @ada.lovelace.' });
    const bare = page({ path: 'eng/beta', title: 'Beta', markdown: 'Ask ada.lovelace.' });
    index.upsert(mention);
    index.upsert(bare);

    const withAt = (await index.search('@ada.lovelace')).map((hit) => hit.id).sort();
    const plain = (await index.search('ada.lovelace')).map((hit) => hit.id).sort();
    expect(withAt).toEqual([bare.id, mention.id].sort());
    expect(plain).toEqual(withAt);
  });

  it('cannot find a handle that the plain-text projection destroys', async () => {
    const hidden = page({ path: 'eng/alpha', title: 'Alpha', markdown: '[owner](@ada.lovelace)' });
    index.upsert(hidden);

    expect(findMentions(hidden.markdown)).toContain('ada.lovelace');
    expect(await index.search('@ada.lovelace')).toEqual([]);
  });

  it('cannot find a handle on a page it has not indexed yet', async () => {
    const missing = page({ path: 'eng/alpha', title: 'Alpha', markdown: 'Ask @ada.lovelace.' });

    expect(findMentions(missing.markdown)).toContain('ada.lovelace');
    expect(index.listIds()).not.toContain(missing.id);
    expect(await index.search('@ada.lovelace')).toEqual([]);
  });

  it('still answers with the body it indexed before an edit it missed', async () => {
    const stale = page({ path: 'eng/alpha', title: 'Alpha', markdown: 'Ask @grace.hopper.' });
    index.upsert(stale);

    // The store owns the file; this index is a cache the writer may fail to update.
    const edited = { ...stale, markdown: 'Ask @ada.lovelace.' };
    expect(findMentions(edited.markdown)).toContain('ada.lovelace');
    expect(await index.search('@ada.lovelace')).toEqual([]);
    expect((await index.search('@grace.hopper')).map((hit) => hit.id)).toEqual([stale.id]);
  });

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  it('keeps the index on disk across a reopen', async () => {
    const target = page({ path: 'eng/alpha', title: 'Alpha', markdown: 'persistedword content' });
    index.upsert(target);
    index.close();

    const reopened = new SearchIndex({ dbPath: db.dbPath });
    reopened.init();
    try {
      expect(reopened.count()).toBe(1);
      expect((await reopened.search('persistedword')).map((hit) => hit.id)).toEqual([target.id]);
    } finally {
      reopened.close();
      index = new SearchIndex({ dbPath: db.dbPath });
    }
  });

  it('opens lazily when init is never called', async () => {
    const lazy = new SearchIndex({ dbPath: ':memory:' });
    try {
      lazy.upsert(page({ path: 'eng/alpha', markdown: 'lazyword content' }));
      expect(await lazy.search('lazyword')).toHaveLength(1);
    } finally {
      lazy.close();
    }
  });

  it('rejects use after close', () => {
    const closed = new SearchIndex({ dbPath: ':memory:' });
    closed.init();
    closed.close();
    expect(() => closed.count()).toThrow(/closed/i);
    expect(() => closed.close()).not.toThrow();
  });

  it('rejects an empty dbPath', () => {
    expect(() => new SearchIndex({ dbPath: '  ' })).toThrow(/dbPath/);
  });
});
