import { mergeText } from '@tablinum/shared';

/** Where the other copy came from, so the conflict dialog can name it. */
export type ConflictSource = 'peer' | 'git';

/** A copy of the page that came from somewhere else. */
export interface RemoteCopy {
  markdown: string;
  rev: string;
  /** Null when the source carries no title, such as a save conflict. */
  title?: string | null;
}

export interface DocConflict {
  base: string;
  /** What this tab holds. */
  local: string;
  /** What the server holds. */
  remote: string;
  /** Both sides in one text, with git-style markers around each clash. */
  merged: string;
  /** The revision of `remote`. The resolution is saved against it. */
  rev: string;
  source: ConflictSource;
}

export type Reconciled =
  /** The two copies already agree. */
  | { kind: 'same' }
  /** The remote copy replaced the local one, and there is nothing left to save. */
  | { kind: 'taken' }
  /** The two edits merged; this text must be written back. */
  | { kind: 'merged'; text: string }
  /** The edits overlap. The user decides, and nothing may be saved until then. */
  | { kind: 'blocked' };

export const MERGE_LABELS = { ours: 'your version', theirs: 'their version' };

export interface LiveDocOptions {
  markdown: string;
  rev: string;
  title: string;
  /** Put this text on screen. The editor adopts it without reporting a change. */
  onAdopt: (markdown: string, title: string) => void;
  onConflict: (conflict: DocConflict | null) => void;
}

/**
 * One page, seen from one tab. It holds three texts: the copy the server confirmed (`base`),
 * the copy on screen (`local`) and whatever arrives from elsewhere. Every incoming copy is
 * merged against the base, so two people editing different parts never see a conflict.
 */
export class LiveDoc {
  #base: string;
  #rev: string;
  #local: string;
  #title: string;
  #baseTitle: string;
  #conflict: DocConflict | null = null;

  private readonly onAdopt: (markdown: string, title: string) => void;
  private readonly onConflict: (conflict: DocConflict | null) => void;

  constructor(options: LiveDocOptions) {
    this.#base = options.markdown;
    this.#local = options.markdown;
    this.#rev = options.rev;
    this.#title = options.title;
    this.#baseTitle = options.title;
    this.onAdopt = options.onAdopt;
    this.onConflict = options.onConflict;
  }

  get rev(): string {
    return this.#rev;
  }

  get local(): string {
    return this.#local;
  }

  get title(): string {
    return this.#title;
  }

  get conflict(): DocConflict | null {
    return this.#conflict;
  }

  /** True while the screen holds bytes the server has not confirmed. */
  get dirty(): boolean {
    return this.#local !== this.#base;
  }

  edit(markdown: string): void {
    this.#local = markdown;
  }

  editTitle(title: string): void {
    this.#title = title;
  }

  /** A save landed. `sent` is the body the server stored, `rev` its new fingerprint. */
  accept(sent: string, rev: string): void {
    this.#base = sent;
    this.#rev = rev;
  }

  acceptTitle(title: string): void {
    this.#baseTitle = title;
  }

  /**
   * Fold a copy from elsewhere into this one. Nothing is adopted while a conflict is open:
   * the user is looking at the two sides and must not have them move underneath.
   */
  reconcile(remote: RemoteCopy, source: ConflictSource): Reconciled {
    if (this.#conflict !== null) return { kind: 'blocked' };

    const nextTitle = this.#pickTitle(remote.title ?? null);

    if (remote.markdown === this.#local) {
      this.#base = remote.markdown;
      this.#rev = remote.rev;
      this.#applyTitle(nextTitle, remote.title ?? null);
      return { kind: 'same' };
    }

    if (this.#local === this.#base) {
      this.#base = remote.markdown;
      this.#rev = remote.rev;
      this.#local = remote.markdown;
      this.#applyTitle(nextTitle, remote.title ?? null);
      this.onAdopt(remote.markdown, this.#title);
      return { kind: 'taken' };
    }

    const merged = mergeText(this.#base, this.#local, remote.markdown, MERGE_LABELS);
    if (!merged.clean) {
      this.#conflict = {
        base: this.#base,
        local: this.#local,
        remote: remote.markdown,
        merged: merged.text,
        rev: remote.rev,
        source,
      };
      this.onConflict(this.#conflict);
      return { kind: 'blocked' };
    }

    this.#base = remote.markdown;
    this.#rev = remote.rev;
    this.#local = merged.text;
    this.#applyTitle(nextTitle, remote.title ?? null);
    this.onAdopt(merged.text, this.#title);
    return { kind: 'merged', text: merged.text };
  }

  /**
   * Take the text the user chose in the conflict dialog. It becomes the local copy and is
   * saved against the revision that caused the conflict, so the next save cannot 409 again.
   */
  resolve(markdown: string): string | null {
    const conflict = this.#conflict;
    if (conflict === null) return null;
    this.#conflict = null;
    this.#base = conflict.remote;
    this.#rev = conflict.rev;
    this.#local = markdown;
    this.onConflict(null);
    this.onAdopt(markdown, this.#title);
    return markdown;
  }

  #pickTitle(remoteTitle: string | null): string {
    if (remoteTitle === null) return this.#title;
    // A title the user is editing wins; an untouched one follows the server.
    return this.#title === this.#baseTitle ? remoteTitle : this.#title;
  }

  #applyTitle(next: string, remoteTitle: string | null): void {
    if (remoteTitle !== null) this.#baseTitle = remoteTitle;
    this.#title = next;
  }
}
