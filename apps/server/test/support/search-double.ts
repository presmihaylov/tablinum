import type { Page, PageId, SearchHit } from '@tablinum/shared';
import type { SearchIndex, SearchOptions } from '../../src/deps.js';

interface Entry {
  id: PageId;
  path: string;
  space: string;
  title: string;
  body: string;
}

const SNIPPET_RADIUS = 60;

function toEntry(page: Page): Entry {
  return {
    id: page.id,
    path: page.path,
    space: page.space,
    title: page.title,
    body: page.markdown,
  };
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => token.length > 0);
}

function snippetFor(body: string, token: string): string {
  const at = body.toLowerCase().indexOf(token);
  if (at === -1) return body.slice(0, SNIPPET_RADIUS * 2).trim();
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(body.length, at + token.length + SNIPPET_RADIUS);
  return `${start > 0 ? '...' : ''}${body.slice(start, end).trim()}${end < body.length ? '...' : ''}`;
}

/** An in-memory stand-in for the FTS index: same contract, no native dependency. */
export class MemorySearchIndex implements SearchIndex {
  readonly #entries = new Map<PageId, Entry>();

  async init(): Promise<void> {
    this.#entries.clear();
  }

  async reindexAll(pages: Iterable<Page>): Promise<number> {
    this.#entries.clear();
    let count = 0;
    for (const page of pages) {
      this.#entries.set(page.id, toEntry(page));
      count += 1;
    }
    return count;
  }

  async indexPage(page: Page): Promise<void> {
    this.#entries.set(page.id, toEntry(page));
  }

  async removePage(id: PageId): Promise<void> {
    this.#entries.delete(id);
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const hits: SearchHit[] = [];
    for (const entry of this.#entries.values()) {
      if (options.space !== undefined && entry.space !== options.space) continue;

      const title = entry.title.toLowerCase();
      const body = entry.body.toLowerCase();
      const path = entry.path.toLowerCase();

      let score = 0;
      let matchedAll = true;
      for (const token of tokens) {
        const inTitle = title.includes(token);
        const inBody = body.includes(token);
        const inPath = path.includes(token);
        if (!inTitle && !inBody && !inPath) {
          matchedAll = false;
          break;
        }
        score += (inTitle ? 3 : 0) + (inBody ? 1 : 0) + (inPath ? 0.5 : 0);
      }
      if (!matchedAll) continue;

      hits.push({
        id: entry.id,
        path: entry.path,
        title: entry.title,
        snippet: snippetFor(entry.body, tokens[0] ?? ''),
        score,
      });
    }

    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, options.limit ?? 20);
  }

  async close(): Promise<void> {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
