import { useState } from 'react';
import { useGitStatus, useGitSync } from '../../api/hooks';
import { useToast } from '../../lib/toast';
import { GitConflictDialog } from '../Conflict/GitConflictDialog';
import { Branch, Sync } from '../ui/Icon';

export function GitStatusPill() {
  const status = useGitStatus();
  const sync = useGitSync();
  const { push, pushError } = useToast();
  const [conflictOpen, setConflictOpen] = useState(false);

  const git = status.data?.status;
  const dirty = git?.dirtyFiles.length ?? 0;
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  const conflict = git?.conflict ?? null;

  const runSync = (): void => {
    sync.mutate(undefined, {
      onSuccess: (result) => {
        const parts: string[] = [];
        if (result.pulled > 0) parts.push(`pulled ${result.pulled}`);
        if (result.pushed) parts.push('pushed');
        push(parts.length > 0 ? `Synced: ${parts.join(', ')}.` : 'Already up to date.', 'success');
      },
      onError: (error) => pushError(error, 'Sync failed.'),
    });
  };

  return (
    <div className="git-pill">
      <div className="git-pill__info" title={git?.remote ?? 'No remote configured'}>
        <Branch size={12} />
        <span className="git-pill__branch">{git?.branch ?? '—'}</span>
        {dirty > 0 ? (
          <span
            className="git-pill__badge git-pill__badge--dirty"
            title={`${dirty} saved file${dirty === 1 ? '' : 's'} waiting for git. They go in one commit once the writing stops.`}
          >
            {dirty}
          </span>
        ) : null}
        {ahead > 0 ? <span className="git-pill__badge">↑{ahead}</span> : null}
        {behind > 0 ? <span className="git-pill__badge">↓{behind}</span> : null}
        {status.isError ? <span className="git-pill__badge git-pill__badge--error">offline</span> : null}
      </div>

      {conflict ? (
        <button
          type="button"
          className="git-pill__badge git-pill__badge--error git-pill__conflict"
          onClick={() => setConflictOpen(true)}
          title={conflict.message}
        >
          {conflict.files.length} conflict{conflict.files.length === 1 ? '' : 's'}
        </button>
      ) : null}

      <button
        type="button"
        className="btn btn--icon"
        onClick={runSync}
        disabled={sync.isPending}
        title="Pull, then push"
        aria-label="Sync with the remote"
      >
        {sync.isPending ? <span className="spinner" /> : <Sync size={13} />}
      </button>

      <GitConflictDialog open={conflictOpen} onClose={() => setConflictOpen(false)} />
    </div>
  );
}
