import type { SaveState } from '../../lib/autosave';

const LABELS: Record<SaveState, string> = {
  idle: 'Saved to git',
  saving: 'Saving…',
  error: 'Retrying…',
};

/** Small status line for the editor. Reused by the real editor. */
export function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className={`save-indicator save-indicator--${state}`} role="status" aria-live="polite">
      {state === 'saving' ? <span className="spinner" /> : null}
      {LABELS[state]}
    </span>
  );
}
