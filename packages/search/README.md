# @tablinum/search

Full-text search over tablinum pages, backed by SQLite FTS5 (`better-sqlite3`).

The index is a **derived cache**. It holds no source of truth, it is never committed, and it can be
deleted at any time and rebuilt from the markdown files with `reindexAll()`.

## Where the database lives

`<contentDir>/../search.db` — a sibling of the content repo, never inside it, so git never sees it.
Use `defaultDbPath(config.contentDir)` rather than building the path by hand.

WAL mode is on, so `search.db-wal` and `search.db-shm` appear beside it. They are outside the
content repo too.

## Usage

```ts
import { getConfig } from '@tablinum/shared';
import { SearchIndex, defaultDbPath } from '@tablinum/search';

const config = getConfig();
const index = new SearchIndex({ dbPath: defaultDbPath(config.contentDir) });
index.init();

index.reindexAll(allPages);      // full rebuild, one transaction
index.upsert(page);              // one page created or changed
index.remove(page.id);           // one page deleted
index.removeSubtree('eng/runbooks'); // a page and everything below it

const hits = await index.search('deploy runbook', { space: 'eng', limit: 20 });

index.close();
```

Every write method is synchronous, because `better-sqlite3` is. `search()` is async so the
signature can absorb a different backend later without a breaking change.

## API

| Member | Purpose |
| --- | --- |
| `init()` | Open the file, create the schema if absent. Idempotent. Called lazily by every other method. |
| `reindexAll(pages)` | Replace the whole index in one transaction. Returns the number of pages. |
| `upsert(page)` / `upsertMany(pages)` | Index or re-index pages. |
| `remove(id)` | Drop one page. Returns `false` when it was not indexed. |
| `removeSubtree(path)` | Drop `path` and every descendant. Returns the removed ids. |
| `search(query, opts)` | `Promise<SearchHit[]>`, best first. |
| `count()` / `listIds()` | Size and contents of the index. |
| `stats()` | `{ pages, indexed }`. The two must be equal; a mismatch means rebuild. |
| `clear()` | Empty both tables, keep the schema. |
| `close()` | Release the handle. The instance is unusable afterwards. |

`upsert` accepts an `IndexablePage`, which a full `Page` satisfies:
`{ id, path, space, title, updated, markdown }`.

## Schema

```sql
pages(id TEXT PRIMARY KEY, path TEXT, space TEXT, title TEXT, updated TEXT)
pages_fts USING fts5(title, body, path, tokenize='porter unicode61')
```

`pages_fts.rowid` is joined to the implicit `pages.rowid`. Every write deletes the matching FTS row
before inserting, and every delete removes both rows, so the two tables never drift.

`body` holds `markdownToPlainText(page.markdown)`, never raw markdown.
`path` is stored space-separated, so `eng/runbooks/deploy` is searchable by any segment.

## Query handling

User input never reaches FTS5 unescaped. It is reduced to letters, digits and underscores, and each
term is re-quoted, so `foo" OR "`, `*`, `NEAR(` and `AND OR NOT` are matched as ordinary words
instead of raising a syntax error. A query with no usable term returns `[]`.

Text inside double quotes stays one phrase: `"incident response"` matches only that word order.

Search runs the exact expression first. If it finds nothing, it retries with the last term as a
prefix, so typing `depl` still finds `deploy`.

## Ranking

`bm25(pages_fts, 3, 1, 0.5)` — title counts about three times body, path counts half. `score` is the
negated bm25 value, so **bigger is better**. Magnitudes are only comparable inside one result set:
bm25 clamps the inverse document frequency of a term that appears in most pages, which pushes every
score in a small corpus close to zero while keeping the order correct.

## Snippets

FTS5 `snippet()` with 20 tokens of context. The delimiters are control codes, so the text is
HTML-escaped **before** they are swapped for `<mark>` / `</mark>`. Page content can therefore never
inject markup into a result row. The snippet is flattened to a single line, and falls back to the
page title when the body holds no text.

## Notes for integration

`better-sqlite3` is a native module. pnpm 10 blocks install scripts by default, so the workspace
root needs:

```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - better-sqlite3
```

Without it the binding is never built and `new Database(...)` throws at runtime.
