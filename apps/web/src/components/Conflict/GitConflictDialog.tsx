import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConflictFile, GitResolveBody } from '@gitdocs/shared';
import { ApiError, api } from '../../api/client';
import { invalidateContent } from '../../api/hooks';
import { useToast } from '../../lib/toast';
import { Modal } from '../ui/Overlay';
import { DiffView } from './DiffView';
import './conflict.css';

interface GitConflictDialogProps {
  open: boolean;
  onClose: () => void;
}

type Choice = 'merged' | 'local' | 'remote';

function textFor(file: ConflictFile, choice: Choice, edited: string): string {
  if (choice === 'local') return file.local;
  if (choice === 'remote') return file.remote;
  return edited;
}

/**
 * The upstream half of conflict handling. Every file git could not rebase is listed with the
 * automatic merge already applied; only the files that still clash need a decision.
 */
export function GitConflictDialog({ open, onClose }: GitConflictDialogProps) {
  const client = useQueryClient();
  const { push, pushError } = useToast();

  const query = useQuery({
    queryKey: ['git', 'conflict'],
    queryFn: ({ signal }) => api.gitConflict(signal),
    enabled: open,
    staleTime: 0,
  });

  const files = useMemo(() => query.data?.files ?? [], [query.data]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);

  useEffect(() => {
    // A clean file needs no decision, so it starts on the merged text.
    setChoices(Object.fromEntries(files.map((file) => [file.file, 'merged' as Choice])));
    setEdited(Object.fromEntries(files.map((file) => [file.file, file.merged])));
    setActive(0);
  }, [files]);

  const resolve = useMutation<unknown, ApiError, GitResolveBody>({
    mutationFn: (body: GitResolveBody) => api.gitResolve(body),
    onSuccess: () => {
      invalidateContent(client);
      void client.invalidateQueries({ queryKey: ['git', 'conflict'] });
      push('The conflict is resolved and committed.', 'success');
      onClose();
    },
    onError: (error) => pushError(error, 'The conflict could not be resolved.'),
  });

  const file = files[active];
  const choice = file ? (choices[file.file] ?? 'merged') : 'merged';
  const draft = file ? (edited[file.file] ?? file.merged) : '';
  const unresolved = files.filter((entry) => !entry.clean).length;

  const submit = (): void => {
    resolve.mutate({
      files: files.map((entry) => ({
        file: entry.file,
        content: textFor(entry, choices[entry.file] ?? 'merged', edited[entry.file] ?? entry.merged),
      })),
    });
  };

  return (
    <Modal
      open={open}
      title="Resolve the conflict with the remote"
      width="56rem"
      onClose={onClose}
      footer={
        <>
          <span className="conflict__hint">
            {unresolved === 0
              ? 'Everything merged automatically. Review it, then commit.'
              : `${unresolved} of ${files.length} file(s) still clash.`}
          </span>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Later
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={resolve.isPending || files.length === 0}
          >
            {resolve.isPending ? 'Committing…' : 'Resolve and commit'}
          </button>
        </>
      }
    >
      {query.isLoading ? <div className="centered-state"><span className="spinner" /></div> : null}

      {!query.isLoading && files.length === 0 ? (
        <p className="conflict__lead">There is nothing left to resolve.</p>
      ) : null}

      {files.length > 0 ? (
        <div className="conflict__split">
          <ul className="conflict__files scroll-y">
            {files.map((entry, index) => (
              <li key={entry.file}>
                <button
                  type="button"
                  className={index === active ? 'conflict__file conflict__file--on' : 'conflict__file'}
                  onClick={() => setActive(index)}
                >
                  <span className="conflict__file-name">{entry.title ?? entry.file}</span>
                  <span className={entry.clean ? 'conflict__tag conflict__tag--ok' : 'conflict__tag'}>
                    {entry.clean ? 'merged' : 'clash'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {file ? (
            <div className="conflict__pane">
              <div className="conflict__tabs" role="tablist" aria-label="Which version to keep">
                {(['merged', 'local', 'remote'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={choice === id}
                    className={choice === id ? 'conflict__tab conflict__tab--on' : 'conflict__tab'}
                    onClick={() => setChoices((prev) => ({ ...prev, [file.file]: id }))}
                  >
                    {id === 'merged' ? 'Merged' : id === 'local' ? 'Only local' : 'Only remote'}
                  </button>
                ))}
              </div>

              {choice === 'merged' ? (
                <textarea
                  className="conflict__editor"
                  value={draft}
                  spellCheck={false}
                  aria-label={`The merged text of ${file.file}`}
                  onChange={(event) =>
                    setEdited((prev) => ({ ...prev, [file.file]: event.target.value }))
                  }
                />
              ) : (
                <DiffView
                  before={choice === 'local' ? file.remote : file.local}
                  after={choice === 'local' ? file.local : file.remote}
                  beforeLabel={choice === 'local' ? 'remote' : 'local'}
                  afterLabel={choice === 'local' ? 'local (kept)' : 'remote (kept)'}
                />
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
