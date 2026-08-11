import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { escapeHtml, internal, markdownToPlainText, validation } from '@tablinum/shared';
import type { Page, PageId, SearchHit } from '@tablinum/shared';
import { buildMatchExpressions, isFtsQueryError, type SearchField } from './query.js';

// The index and its snippets are the oldest readers of this, so it keeps answering here.
export { escapeHtml, markdownToPlainText } from '@tablinum/shared';
export type { PlainTextOptions } from '@tablinum/shared';
export { buildMatchExpressions, parseQuery, SEARCH_FIELDS, toMatchExpression } from './query.js';
export type { Phrase, SearchField } from './query.js';

type Db = Database.Database;

/** Filename of the derived index. It lives beside the content repo, never inside it. */
export const SEARCH_DB_FILENAME = 'search.db';

/** The index is a rebuildable cache; bump this to force a rebuild on the next boot. */
const SCHEMA_VERSION = 3;

/** bm25 column weights, in the declared order of pages_fts: title, body, path. */
const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;
const PATH_WEIGHT = 0.5;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const SNIPPET_TOKENS = 20;

/** Column index of `body` inside pages_fts; snippet() takes the position, not the name. */
const BODY_COLUMN = 1;

/**
 * snippet() must emit delimiters that survive HTML escaping, so it emits control
 * codes and we swap them for <mark> after escaping.
 */
const MARK_OPEN = '\u0001';
const MARK_CLOSE = '\u0002';

/**
 * The index never stores the whole content repo, only what a result row needs.
 * A full `Page` satisfies this, so callers can pass one straight through.
 */
export type IndexablePage = Pick<
  Page,
  'id' | 'path' | 'space' | 'title' | 'updated' | 'markdown' | 'icon'
>;

export interface SearchIndexOptions {
  /** Absolute path of the SQLite file, or ":memory:" for a throwaway index. */
  dbPath: string;
  /** Open the file read-only. A reader never creates the schema. */
  readonly?: boolean;
}

export interface SearchOptions {
  /** Restrict to one space slug. */
  space?: string;
  /** 1..200, default 20. */
  limit?: number;
  /**
   * Restrict the match to these columns. Omitted, every column answers, which is
   * full text. `['title', 'path']` is the name of a page and nothing else.
   */
  fields?: readonly SearchField[];
}

interface PageRow {
  id: string;
  path: string;
  title: string;
  icon: string;
  rank_score: number;
  snip: string | null;
}

interface RowIdRow {
  rowid: number;
}

interface CountRow {
  total: number;
}

interface IdRow {
  id: string;
}

/** Standard path of the index: a sibling of the content repo, so git never sees it. */
export function defaultDbPath(contentDir: string): string {
  return resolve(contentDir, '..', SEARCH_DB_FILENAME);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

/** Escape first, then reveal the delimiters, so page content can never inject markup. */
function renderSnippet(raw: string | null, fallbackTitle: string): string {
  // A snippet spans paragraph breaks; a result row is one line, so flatten it.
  const flat = (raw ?? '').replace(/\s+/g, ' ').trim();
  const marked = escapeHtml(flat).split(MARK_OPEN).join('<mark>').split(MARK_CLOSE).join('</mark>');
  if (marked.length > 0) return marked;
  return escapeHtml(fallbackTitle.trim());
}

/**
 * Full-text index over pages, backed by SQLite FTS5.
 *
 * It is a derived cache: it can be deleted at any time and rebuilt from the markdown
 * files with reindexAll(). Nothing here is a source of truth.
 */
export class SearchIndex {
  private readonly dbPath: string;
  private readonly readonlyMode: boolean;
  private db: Db | null = null;
  private closed = false;

  constructor(options: SearchIndexOptions) {
    const dbPath = options.dbPath;
    if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
      throw validation('SearchIndex requires a non-empty dbPath');
    }
    this.dbPath = dbPath;
    this.readonlyMode = options.readonly === true;
  }

  /** Open the database and create the schema if it is absent. Safe to call repeatedly. */
  init(): void {
    if (this.closed) throw internal('Search index is closed');
    if (this.db !== null) return;

    if (this.dbPath !== ':memory:' && !this.readonlyMode) {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }

    const db = new Database(this.dbPath, { readonly: this.readonlyMode });
    this.db = db;

    if (this.readonlyMode) return;

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    const version = this.readUserVersion(db);
    if (version !== 0 && version !== SCHEMA_VERSION) {
      db.exec('DROP TABLE IF EXISTS pages_fts; DROP TABLE IF EXISTS pages;');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id      TEXT PRIMARY KEY,
        path    TEXT NOT NULL,
        space   TEXT NOT NULL,
        title   TEXT NOT NULL DEFAULT '',
        icon    TEXT NOT NULL DEFAULT '',
        updated TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS pages_space_idx ON pages(space);
      CREATE INDEX IF NOT EXISTS pages_path_idx ON pages(path);
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts
        USING fts5(title, body, path, tokenize='porter unicode61');
    `);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  /** Replace the whole index in one transaction, so readers never see a half-built index. */
  reindexAll(pages: Iterable<IndexablePage>): number {
    const db = this.handle();
    const { write } = this.writers(db);
    const rebuild = db.transaction((batch: readonly IndexablePage[]): number => {
      db.prepare('DELETE FROM pages_fts').run();
      db.prepare('DELETE FROM pages').run();
      for (const page of batch) write(page);
      return batch.length;
    });
    return rebuild([...pages]);
  }

  /** Index a page, or replace what is already indexed for its id. */
  upsert(page: IndexablePage): void {
    this.upsertMany([page]);
  }

  /** Index several pages in one transaction. */
  upsertMany(pages: Iterable<IndexablePage>): number {
    const db = this.handle();
    const { write } = this.writers(db);
    const run = db.transaction((batch: readonly IndexablePage[]): number => {
      for (const page of batch) write(page);
      return batch.length;
    });
    return run([...pages]);
  }

  /** Drop a page from the index. Returns false when it was not indexed. */
  remove(id: PageId): boolean {
    const db = this.handle();
    const { drop } = this.writers(db);
    return db.transaction((pageId: string): boolean => drop(pageId))(id);
  }

  /** Drop every page whose path is `path` or sits below it. Returns the ids removed. */
  removeSubtree(path: string): PageId[] {
    const db = this.handle();
    const { drop } = this.writers(db);
    const run = db.transaction((prefix: string): PageId[] => {
      const rows = db
        .prepare<[string, string], IdRow>('SELECT id FROM pages WHERE path = ? OR path LIKE ?')
        .all(prefix, `${prefix}/%`);
      for (const row of rows) drop(row.id);
      return rows.map((row) => row.id);
    });
    return run(path);
  }

  /** Number of indexed pages. */
  count(): number {
    const row = this.handle()
      .prepare<[], CountRow>('SELECT COUNT(*) AS total FROM pages')
      .get();
    return row?.total ?? 0;
  }

  /**
   * Row counts of both tables. They must be equal: an orphan row in pages_fts is
   * invisible to search but wastes space, so a mismatch means the index needs a rebuild.
   */
  stats(): { pages: number; indexed: number } {
    const db = this.handle();
    const pages = db.prepare<[], CountRow>('SELECT COUNT(*) AS total FROM pages').get();
    const indexed = db.prepare<[], CountRow>('SELECT COUNT(*) AS total FROM pages_fts').get();
    return { pages: pages?.total ?? 0, indexed: indexed?.total ?? 0 };
  }

  /** Every indexed page id. Lets a caller diff the index against the content repo. */
  listIds(): PageId[] {
    return this.handle()
      .prepare<[], IdRow>('SELECT id FROM pages ORDER BY id')
      .all()
      .map((row) => row.id);
  }

  /** Delete everything without dropping the schema. */
  clear(): void {
    const db = this.handle();
    db.transaction(() => {
      db.prepare('DELETE FROM pages_fts').run();
      db.prepare('DELETE FROM pages').run();
    })();
  }

  /**
   * Rank pages against a free-text query.
   * Hostile input never throws: it is reduced to quoted terms, and a query with no
   * usable term returns an empty list.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const expressions = buildMatchExpressions(query, opts.fields);
    if (expressions.length === 0) return [];

    for (const expression of expressions) {
      const hits = this.runMatch(expression, opts);
      if (hits === null) continue;
      if (hits.length > 0) return hits;
    }
    return [];
  }

  /** Close the handle. The instance is unusable afterwards. */
  close(): void {
    this.closed = true;
    if (this.db === null) return;
    this.db.close();
    this.db = null;
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private handle(): Db {
    if (this.closed) throw internal('Search index is closed');
    if (this.db === null) this.init();
    const db = this.db;
    if (db === null) throw internal('Search index failed to open');
    return db;
  }

  private readUserVersion(db: Db): number {
    const value: unknown = db.pragma('user_version', { simple: true });
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Compile the write statements once and hand back closures over them.
   * A bulk reindex would otherwise re-compile the same four statements for every page.
   */
  private writers(db: Db): {
    write: (page: IndexablePage) => void;
    drop: (id: string) => boolean;
  } {
    const upsertPage = db.prepare<[string, string, string, string, string, string]>(
      `INSERT INTO pages (id, path, space, title, icon, updated)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path,
         space = excluded.space,
         title = excluded.title,
         icon = excluded.icon,
         updated = excluded.updated`,
    );
    const selectRowId = db.prepare<[string], RowIdRow>(
      'SELECT rowid AS rowid FROM pages WHERE id = ?',
    );
    const deleteFts = db.prepare<[number]>('DELETE FROM pages_fts WHERE rowid = ?');
    const deletePage = db.prepare<[string]>('DELETE FROM pages WHERE id = ?');
    const insertFts = db.prepare<[number, string, string, string]>(
      'INSERT INTO pages_fts (rowid, title, body, path) VALUES (?, ?, ?, ?)',
    );

    return {
      write: (page) => {
        upsertPage.run(
          page.id,
          page.path,
          page.space,
          page.title ?? '',
          page.icon ?? '',
          page.updated ?? '',
        );

        const row = selectRowId.get(page.id);
        if (row === undefined) throw internal(`Failed to index page ${page.id}`);

        // pages_fts has no key of its own, so the stale row must go before the new one lands.
        deleteFts.run(row.rowid);
        insertFts.run(
          row.rowid,
          page.title ?? '',
          markdownToPlainText(page.markdown ?? ''),
          // Slashes are separators to the tokenizer already; splitting keeps that explicit.
          page.path.split('/').join(' '),
        );
      },
      drop: (id) => {
        const row = selectRowId.get(id);
        if (row === undefined) return false;
        deleteFts.run(row.rowid);
        deletePage.run(id);
        return true;
      },
    };
  }

  /** Run one MATCH expression. Returns null when FTS5 rejects the expression. */
  private runMatch(expression: string, opts: SearchOptions): SearchHit[] | null {
    const db = this.handle();
    const conditions = ['pages_fts MATCH @match'];
    const params: Record<string, string | number> = {
      match: expression,
      limit: clampLimit(opts.limit),
    };

    const space = opts.space?.trim();
    if (space !== undefined && space.length > 0) {
      conditions.push('p.space = @space');
      params.space = space;
    }

    const sql = `
      SELECT p.id            AS id,
             p.path          AS path,
             p.title         AS title,
             p.icon          AS icon,
             bm25(pages_fts, ${TITLE_WEIGHT}, ${BODY_WEIGHT}, ${PATH_WEIGHT}) AS rank_score,
             snippet(pages_fts, ${BODY_COLUMN}, char(1), char(2), '...', ${SNIPPET_TOKENS}) AS snip
      FROM pages_fts
      JOIN pages p ON p.rowid = pages_fts.rowid
      WHERE ${conditions.join(' AND ')}
      ORDER BY rank_score ASC, p.updated DESC, p.path ASC
      LIMIT @limit`;

    try {
      const rows = db.prepare<[Record<string, string | number>], PageRow>(sql).all(params);
      return rows.map((row) => {
        const hit: SearchHit = {
          id: row.id,
          path: row.path,
          title: row.title,
          snippet: renderSnippet(row.snip, row.title),
          // bm25() is negative and better the lower it goes; invert so bigger means better.
          score: Number.isFinite(row.rank_score) ? -row.rank_score : 0,
        };
        // A page with no icon stores the empty string, and the wire shape omits the field.
        if (row.icon.length > 0) hit.icon = row.icon;
        return hit;
      });
    } catch (err) {
      if (isFtsQueryError(err)) return null;
      throw err;
    }
  }
}
