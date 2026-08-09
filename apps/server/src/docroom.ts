import { MAX_ROOM_STEPS, type DocBaseline, type DocStep, type PagePath } from '@tablinum/shared';

/**
 * One page that tabs are streaming into. The server never parses a step: it puts them in an
 * order, hands that order to everyone, and lets each editor rebase its own work. That keeps
 * the schema in the browser, where it belongs, and keeps markdown the only thing on disk.
 */
export interface DocRoom {
  path: PagePath;
  /** The markdown every step below is applied on top of. */
  baseline: DocBaseline;
  /** The version the baseline sits at. Versions never go backwards. */
  baseVersion: number;
  steps: DocStep[];
  /** Join order. The first member writes the file; the rest only stream. */
  members: string[];
}

export type SubmitResult =
  | { ok: true; version: number; steps: DocStep[] }
  /** The tab built these steps on an older version and must rebase them itself. */
  | { ok: false; reason: 'stale' | 'overflow' | 'unknown' };

/** The version a room is at: its baseline plus everything accepted since. */
export function versionOf(room: DocRoom): number {
  return room.baseVersion + room.steps.length;
}

/** The tab that saves this room. Null once the room is empty. */
export function writerOf(room: DocRoom): string | null {
  return room.members[0] ?? null;
}

/** Every open room, keyed by page path. A room lives only while a tab is in it. */
export class DocRooms {
  readonly #rooms = new Map<PagePath, DocRoom>();

  get size(): number {
    return this.#rooms.size;
  }

  get(path: PagePath): DocRoom | null {
    return this.#rooms.get(path) ?? null;
  }

  /** Join a room, creating it from the given baseline when this tab is the first one in. */
  open(path: PagePath, client: string, baseline: DocBaseline): DocRoom {
    const existing = this.#rooms.get(path);
    if (existing !== undefined) {
      if (!existing.members.includes(client)) existing.members.push(client);
      return existing;
    }
    const room: DocRoom = { path, baseline, baseVersion: 0, steps: [], members: [client] };
    this.#rooms.set(path, room);
    return room;
  }

  /** Leave a room. The room is discarded once the last tab is out of it. */
  close(path: PagePath, client: string): DocRoom | null {
    const room = this.#rooms.get(path);
    if (room === undefined) return null;
    room.members = room.members.filter((id) => id !== client);
    if (room.members.length > 0) return room;
    this.#rooms.delete(path);
    return null;
  }

  /** Take a disconnected tab out of every room it was in. */
  closeAllFor(client: string): PagePath[] {
    const left: PagePath[] = [];
    for (const path of [...this.#rooms.keys()]) {
      const room = this.#rooms.get(path);
      if (room === undefined || !room.members.includes(client)) continue;
      this.close(path, client);
      left.push(path);
    }
    return left;
  }

  /**
   * Add steps to the log. They are only accepted at the head of the room, so two tabs that
   * type at the same instant cannot interleave: the slower one rebases and sends again.
   */
  submit(path: PagePath, client: string, version: number, steps: unknown[]): SubmitResult {
    const room = this.#rooms.get(path);
    if (room === undefined) return { ok: false, reason: 'unknown' };
    if (version !== versionOf(room)) return { ok: false, reason: 'stale' };
    if (room.steps.length + steps.length > MAX_ROOM_STEPS) return { ok: false, reason: 'overflow' };

    const added = steps.map((step) => ({ step, client }));
    room.steps.push(...added);
    return { ok: true, version: versionOf(room), steps: added };
  }

  /**
   * Move the baseline forward to text that is now on disk and throw the log away. Only the
   * writer may do it, and only when no step has landed since the save it is reporting;
   * otherwise a tab still holding those steps would be rebased onto text without them.
   */
  rebaseline(path: PagePath, client: string, version: number, baseline: DocBaseline): boolean {
    const room = this.#rooms.get(path);
    if (room === undefined) return false;
    if (writerOf(room) !== client) return false;
    if (version !== versionOf(room)) return false;

    room.baseline = baseline;
    room.baseVersion = version;
    room.steps = [];
    return true;
  }

  /** Throw a room away. Its members are told to rejoin from the file. */
  drop(path: PagePath): DocRoom | null {
    const room = this.#rooms.get(path);
    if (room === undefined) return null;
    this.#rooms.delete(path);
    return room;
  }

  clear(): void {
    this.#rooms.clear();
  }
}
