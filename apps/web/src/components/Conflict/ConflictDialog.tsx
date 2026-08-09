import { useEffect, useState } from 'react';
import type { DocConflict } from '../../lib/livedoc';
import { Modal } from '../ui/Overlay';
import { DiffView } from './DiffView';
import './conflict.css';

interface ConflictDialogProps {
  conflict: DocConflict | null;
  /** The text to keep. It is saved straight away. */
  onResolve: (markdown: string) => void;
}

type Choice = 'merged' | 'local' | 'remote';

const SOURCE_TEXT: Record<DocConflict['source'], string> = {
  peer: 'Someone else edited this page at the same time.',
  git: 'The git remote changed this page while you were editing it.',
};

/**
 * Shown only when the two edits touch the same lines. Everything else merges silently,
 * so reaching this dialog already means a real decision has to be made.
 */
export function ConflictDialog({ conflict, onResolve }: ConflictDialogProps) {
  const [choice, setChoice] = useState<Choice>('merged');
  const [merged, setMerged] = useState('');

  // A new conflict starts a fresh decision; the same one must not reset what is being edited.
  useEffect(() => {
    if (conflict === null) return;
    setChoice('merged');
    setMerged(conflict.merged);
  }, [conflict]);

  if (conflict === null) return null;

  const keep = (): void => {
    if (choice === 'local') return onResolve(conflict.local);
    if (choice === 'remote') return onResolve(conflict.remote);
    onResolve(merged);
  };

  return (
    <Modal
      open
      title="This page changed while you were editing"
      width="52rem"
      onClose={keep}
      footer={
        <>
          <span className="conflict__hint">
            {choice === 'merged' ? 'Delete the <<<<<<< markers before you save.' : ''}
          </span>
          <button type="button" className="btn btn--primary" onClick={keep}>
            {choice === 'merged' ? 'Save the merged page' : 'Save this version'}
          </button>
        </>
      }
    >
      <p className="conflict__lead">
        {SOURCE_TEXT[conflict.source]} The parts that do not overlap are merged already. Choose what to
        keep for the rest.
      </p>

      <div className="conflict__tabs" role="tablist" aria-label="Which version to keep">
        <Tab id="merged" choice={choice} onPick={setChoice} label="Both, with markers" />
        <Tab id="local" choice={choice} onPick={setChoice} label="Only your version" />
        <Tab id="remote" choice={choice} onPick={setChoice} label="Only their version" />
      </div>

      {choice === 'merged' ? (
        <textarea
          className="conflict__editor"
          value={merged}
          spellCheck={false}
          aria-label="The merged page"
          onChange={(event) => setMerged(event.target.value)}
        />
      ) : (
        <DiffView
          before={choice === 'local' ? conflict.remote : conflict.local}
          after={choice === 'local' ? conflict.local : conflict.remote}
          beforeLabel={choice === 'local' ? 'their version' : 'your version'}
          afterLabel={choice === 'local' ? 'your version (kept)' : 'their version (kept)'}
        />
      )}
    </Modal>
  );
}

interface TabProps {
  id: Choice;
  choice: Choice;
  label: string;
  onPick: (choice: Choice) => void;
}

function Tab({ id, choice, label, onPick }: TabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={choice === id}
      className={choice === id ? 'conflict__tab conflict__tab--on' : 'conflict__tab'}
      onClick={() => onPick(id)}
    >
      {label}
    </button>
  );
}
