/**
 * Minimal FIFO async mutex. Every git mutation goes through one of these so a pull, a commit
 * and a push can never run at the same time and fight over `.git/index.lock`.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private held = 0;

  /** True while a task holds the lock or is queued for it. */
  get locked(): boolean {
    return this.held > 0;
  }

  /** How many tasks are queued behind the task that currently holds the lock. */
  get waiting(): number {
    return this.held === 0 ? 0 : this.held - 1;
  }

  /** Run `task` once every earlier caller has finished. Order is strictly first in, first out. */
  async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    this.held += 1;
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      this.held -= 1;
      release();
    }
  }

  /** Resolve once the queue is empty. Useful for shutdown and for tests. */
  async drain(): Promise<void> {
    await this.runExclusive(() => undefined);
  }
}
