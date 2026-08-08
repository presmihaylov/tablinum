/**
 * Minimal FIFO async mutex. Every content mutation goes through one of these, because a page
 * write is a long chain of awaits: without it two concurrent creates of the same path both pass
 * the "is this path free" check and one page is lost.
 */
export class Mutex {
  #tail: Promise<void> = Promise.resolve();
  #held = 0;

  /** True while a task holds the lock or is queued for it. */
  get locked(): boolean {
    return this.#held > 0;
  }

  /** Run `task` once every earlier caller has finished. Order is strictly first in, first out. */
  async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    this.#held += 1;
    const previous = this.#tail;
    let release: () => void = () => undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      this.#held -= 1;
      release();
    }
  }

  /** Resolve once the queue is empty. */
  async drain(): Promise<void> {
    await this.runExclusive(() => undefined);
  }
}
