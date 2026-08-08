import { describe, expect, it } from 'vitest';
import { Mutex } from '../src/mutex.js';
import { sleep } from './helpers.js';

describe('Mutex', () => {
  it('runs tasks one at a time', async () => {
    const mutex = new Mutex();
    let active = 0;
    let maxActive = 0;

    const task = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active -= 1;
    };

    await Promise.all([1, 2, 3, 4, 5].map(() => mutex.runExclusive(task)));
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });

  it('keeps first in, first out order', async () => {
    const mutex = new Mutex();
    const order: number[] = [];
    const delays = [20, 1, 10, 0, 5];

    await Promise.all(
      delays.map((delay, index) =>
        mutex.runExclusive(async () => {
          await sleep(delay);
          order.push(index);
        }),
      ),
    );

    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('releases the lock when a task throws', async () => {
    const mutex = new Mutex();
    await expect(
      mutex.runExclusive(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    expect(mutex.locked).toBe(false);
    await expect(mutex.runExclusive(() => 'still works')).resolves.toBe('still works');
  });

  it('reports how many tasks are queued', async () => {
    const mutex = new Mutex();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = mutex.runExclusive(() => gate);
    const second = mutex.runExclusive(() => undefined);
    const third = mutex.runExclusive(() => undefined);

    await sleep(1);
    expect(mutex.locked).toBe(true);
    expect(mutex.waiting).toBe(2);

    release();
    await Promise.all([first, second, third]);
    expect(mutex.locked).toBe(false);
    expect(mutex.waiting).toBe(0);
  });

  it('drain resolves after every queued task', async () => {
    const mutex = new Mutex();
    const done: number[] = [];
    void mutex.runExclusive(async () => {
      await sleep(10);
      done.push(1);
    });
    void mutex.runExclusive(async () => {
      await sleep(5);
      done.push(2);
    });

    await mutex.drain();
    expect(done).toEqual([1, 2]);
  });
});
