import type { PageId } from '@tablinum/shared';

/** How many recent bodies to remember per page. Covers a long burst of concurrent saves. */
export const DEFAULT_HISTORY_DEPTH = 64;

/** Total bytes of remembered text. Bounds what a large page under load can hold. */
export const DEFAULT_HISTORY_BYTES = 32 * 1024 * 1024;

interface PageHistory {
  /** Insertion-ordered: the oldest rev is the first key. */
  revs: Map<string, string>;
  bytes: number;
}

/**
 * Recent bodies of recently written pages, keyed by the rev they hashed to.
 *
 * A save that arrives against an older rev is not necessarily a conflict: if the server still
 * has the text that rev named, it can merge the edit against it instead of rejecting it. Without
 * this the second of two concurrent saves can only be refused, which is what turned ten people
 * typing into a storm of 409s.
 *
 * Depth matters more than it looks. A writer that is N saves behind needs the text from N saves
 * ago, so a shallow ring silently turns back into the storm it was meant to stop.
 */
export class RevHistory {
  readonly #depth: number;
  readonly #maxBytes: number;
  // Insertion-ordered, so the least recently touched page is the first key.
  readonly #pages = new Map<PageId, PageHistory>();
  #bytes = 0;

  constructor(depth: number = DEFAULT_HISTORY_DEPTH, maxBytes: number = DEFAULT_HISTORY_BYTES) {
    this.#depth = Math.max(1, depth);
    this.#maxBytes = Math.max(1, maxBytes);
  }

  /** Remember `body` under the rev it hashes to. */
  record(id: PageId, rev: string, body: string): void {
    const existing = this.#pages.get(id);
    const page = existing ?? { revs: new Map<string, string>(), bytes: 0 };
    // Re-insert so the most recently touched page is the last key and evicts last.
    if (existing !== undefined) this.#pages.delete(id);
    this.#pages.set(id, page);

    const previous = page.revs.get(rev);
    if (previous !== undefined) {
      page.revs.delete(rev);
      page.bytes -= previous.length;
      this.#bytes -= previous.length;
    }
    page.revs.set(rev, body);
    page.bytes += body.length;
    this.#bytes += body.length;

    while (page.revs.size > this.#depth) {
      if (!this.#dropOldestRev(page)) break;
    }
    while (this.#bytes > this.#maxBytes && this.#pages.size > 0) {
      if (!this.#evictOldest()) break;
    }
  }

  /** The body that hashed to `rev`, or null when it is too old or was never seen. */
  find(id: PageId, rev: string): string | null {
    return this.#pages.get(id)?.revs.get(rev) ?? null;
  }

  forget(id: PageId): void {
    const page = this.#pages.get(id);
    if (page === undefined) return;
    this.#bytes -= page.bytes;
    this.#pages.delete(id);
  }

  clear(): void {
    this.#pages.clear();
    this.#bytes = 0;
  }

  get size(): number {
    return this.#pages.size;
  }

  get bytes(): number {
    return this.#bytes;
  }

  #dropOldestRev(page: PageHistory): boolean {
    const oldest = page.revs.entries().next();
    if (oldest.done === true) return false;
    const [rev, body] = oldest.value;
    page.revs.delete(rev);
    page.bytes -= body.length;
    this.#bytes -= body.length;
    return true;
  }

  /** Trim the least recently touched page, dropping it once it holds nothing. */
  #evictOldest(): boolean {
    const oldest = this.#pages.entries().next();
    if (oldest.done === true) return false;
    const [id, page] = oldest.value;
    if (!this.#dropOldestRev(page)) {
      this.#pages.delete(id);
      return true;
    }
    if (page.revs.size === 0) this.#pages.delete(id);
    return true;
  }
}
