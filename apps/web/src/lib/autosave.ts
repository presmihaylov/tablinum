import type { UpdatePageBody } from '@tablinum/shared';

/** What the save indicator shows. Passed straight to the editor. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveOptions {
  save: (patch: UpdatePageBody) => Promise<unknown>;
  onState?: (state: SaveState) => void;
  /** Quiet period after the last edit before a PATCH goes out. */
  delayMs?: number;
  /** How long "saved" stays on screen before it fades back to idle. */
  savedResetMs?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
}

const DEFAULT_DELAY_MS = 800;
const DEFAULT_SAVED_RESET_MS = 1600;
const DEFAULT_BASE_RETRY_MS = 1000;
const DEFAULT_MAX_RETRY_MS = 30_000;

/**
 * Debounced, self-retrying page saver. Edits are merged into one pending patch, so a
 * burst of keystrokes costs a single PATCH. A failed patch is merged back in front of
 * anything newer, so no edit is ever dropped.
 */
export class Autosave {
  private readonly save: (patch: UpdatePageBody) => Promise<unknown>;
  private readonly onState: ((state: SaveState) => void) | undefined;
  private readonly delayMs: number;
  private readonly savedResetMs: number;
  private readonly baseRetryMs: number;
  private readonly maxRetryMs: number;

  private pending: UpdatePageBody | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private current: Promise<void> | null = null;
  private attempt = 0;
  private disposed = false;
  private currentState: SaveState = 'idle';

  constructor(options: AutosaveOptions) {
    this.save = options.save;
    this.onState = options.onState;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.savedResetMs = options.savedResetMs ?? DEFAULT_SAVED_RESET_MS;
    this.baseRetryMs = options.baseRetryMs ?? DEFAULT_BASE_RETRY_MS;
    this.maxRetryMs = options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
  }

  get state(): SaveState {
    return this.currentState;
  }

  /** True while an edit is unsaved or in flight. Drives the unload warning. */
  get dirty(): boolean {
    return this.pending !== null || this.current !== null;
  }

  queue(patch: UpdatePageBody): void {
    if (this.disposed) return;
    this.pending = { ...(this.pending ?? {}), ...patch };
    this.attempt = 0;
    this.clearResetTimer();
    this.arm(this.delayMs);
  }

  /** Save right now and wait for it. Used on navigation, Cmd+S and unmount. */
  async flush(): Promise<void> {
    this.clearTimer();
    await this.current;
    await this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.clearResetTimer();
  }

  private setState(next: SaveState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    this.onState?.(next);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private clearResetTimer(): void {
    if (this.resetTimer === null) return;
    clearTimeout(this.resetTimer);
    this.resetTimer = null;
  }

  private arm(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private run(): Promise<void> {
    if (this.disposed || this.current !== null || this.pending === null) return Promise.resolve();
    const promise = this.execute(this.pending).finally(() => {
      this.current = null;
    });
    this.pending = null;
    this.current = promise;
    return promise;
  }

  private async execute(patch: UpdatePageBody): Promise<void> {
    this.setState('saving');
    try {
      await this.save(patch);
      this.attempt = 0;
      if (this.pending !== null) {
        this.arm(this.delayMs);
        return;
      }
      this.setState('saved');
      this.scheduleIdle();
    } catch {
      // The failed patch is older than anything queued while it was in flight.
      this.pending = { ...patch, ...(this.pending ?? {}) };
      this.attempt += 1;
      this.setState('error');
      this.arm(this.retryDelay());
    }
  }

  private retryDelay(): number {
    const exponent = Math.max(this.attempt - 1, 0);
    return Math.min(this.baseRetryMs * 2 ** exponent, this.maxRetryMs);
  }

  private scheduleIdle(): void {
    this.clearResetTimer();
    this.resetTimer = setTimeout(() => {
      this.resetTimer = null;
      if (this.pending === null && this.current === null) this.setState('idle');
    }, this.savedResetMs);
  }
}
