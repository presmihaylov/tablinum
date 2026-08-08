import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdatePageBody } from '@gitdocs/shared';
import { Autosave, type SaveState } from '../src/lib/autosave';

function harness(options: { fail?: number } = {}) {
  let failuresLeft = options.fail ?? 0;
  const calls: UpdatePageBody[] = [];
  const states: SaveState[] = [];

  const save = vi.fn(async (patch: UpdatePageBody) => {
    calls.push(patch);
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error('network down');
    }
    return { ok: true };
  });

  const autosave = new Autosave({
    save,
    onState: (state) => states.push(state),
    delayMs: 800,
    savedResetMs: 1600,
    baseRetryMs: 1000,
    maxRetryMs: 8000,
  });

  return { autosave, save, calls, states };
}

describe('Autosave debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once for a burst of changes and sends the merged patch', async () => {
    const { autosave, save, calls } = harness();

    autosave.queue({ markdown: 'a' });
    await vi.advanceTimersByTimeAsync(200);
    autosave.queue({ markdown: 'ab' });
    await vi.advanceTimersByTimeAsync(200);
    autosave.queue({ title: 'Deploy guide' });
    await vi.advanceTimersByTimeAsync(200);
    autosave.queue({ markdown: 'abc' });

    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);

    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual({ markdown: 'abc', title: 'Deploy guide' });

    autosave.dispose();
  });

  it('keeps waiting while the user keeps typing', async () => {
    const { autosave, save } = harness();

    for (let i = 0; i < 10; i += 1) {
      autosave.queue({ markdown: `line ${i}` });
      await vi.advanceTimersByTimeAsync(700);
    }

    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);

    autosave.dispose();
  });

  it('saves twice for two separate bursts', async () => {
    const { autosave, save, calls } = harness();

    autosave.queue({ markdown: 'first' });
    await vi.advanceTimersByTimeAsync(900);
    autosave.queue({ markdown: 'second' });
    await vi.advanceTimersByTimeAsync(900);

    expect(save).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.markdown)).toEqual(['first', 'second']);

    autosave.dispose();
  });

  it('reports idle -> saving -> saved -> idle', async () => {
    const { autosave, states } = harness();

    autosave.queue({ markdown: 'x' });
    await vi.advanceTimersByTimeAsync(800);
    expect(states).toEqual(['saving', 'saved']);

    await vi.advanceTimersByTimeAsync(1600);
    expect(states).toEqual(['saving', 'saved', 'idle']);
    expect(autosave.state).toBe('idle');

    autosave.dispose();
  });

  it('flush saves at once without waiting for the debounce', async () => {
    const { autosave, save } = harness();

    autosave.queue({ markdown: 'now' });
    await autosave.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.dirty).toBe(false);

    autosave.dispose();
  });

  it('never loses an edit that failed to save', async () => {
    const { autosave, save, calls, states } = harness({ fail: 2 });

    autosave.queue({ markdown: 'important' });
    await vi.advanceTimersByTimeAsync(800);

    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.state).toBe('error');
    expect(autosave.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(1000); // first retry
    expect(save).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000); // second retry, backed off
    expect(save).toHaveBeenCalledTimes(3);

    expect(calls.every((patch) => patch.markdown === 'important')).toBe(true);
    expect(autosave.state).toBe('saved');
    expect(autosave.dirty).toBe(false);
    expect(states).toContain('error');

    autosave.dispose();
  });

  it('merges newer edits on top of a failed patch', async () => {
    const { autosave, calls } = harness({ fail: 1 });

    autosave.queue({ markdown: 'v1', title: 'Old' });
    await vi.advanceTimersByTimeAsync(800);
    autosave.queue({ markdown: 'v2' });

    await vi.advanceTimersByTimeAsync(1000);

    expect(calls[1]).toEqual({ markdown: 'v2', title: 'Old' });

    autosave.dispose();
  });

  it('ignores edits queued after dispose', async () => {
    const { autosave, save } = harness();

    autosave.dispose();
    autosave.queue({ markdown: 'ghost' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(save).not.toHaveBeenCalled();
  });
});
