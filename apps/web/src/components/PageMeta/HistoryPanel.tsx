import { useState } from 'react';
import type { PageId } from '@gitdocs/shared';
import { useHistory, useRevision } from '../../api/hooks';
import { absoluteTime, relativeTime, shortSha } from '../../lib/format';
import { Modal } from '../ui/Overlay';

interface HistoryPanelProps {
  pageId: PageId;
  enabled: boolean;
}

export function HistoryPanel({ pageId, enabled }: HistoryPanelProps) {
  const history = useHistory(pageId, 25, enabled);
  const [sha, setSha] = useState<string | null>(null);

  if (history.isLoading) return <p className="empty-note">Loading…</p>;
  if (history.isError) return <p className="empty-note">History is unavailable.</p>;

  const revisions = history.data?.revisions ?? [];
  if (revisions.length === 0) return <p className="empty-note">No commits touch this page yet.</p>;

  return (
    <>
      <ul className="history">
        {revisions.map((revision) => (
          <li key={revision.sha}>
            <button type="button" className="history__item" onClick={() => setSha(revision.sha)}>
              <span className="history__message">{revision.message.split('\n')[0]}</span>
              <span className="history__meta">
                <code className="history__sha">{shortSha(revision.sha)}</code>
                <span title={absoluteTime(revision.date)}>{relativeTime(revision.date)}</span>
                <span className="faint">{revision.author}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <RevisionPreview pageId={pageId} sha={sha} onClose={() => setSha(null)} />
    </>
  );
}

interface RevisionPreviewProps {
  pageId: PageId;
  sha: string | null;
  onClose: () => void;
}

/** Read-only look at a page as it was in one commit. */
function RevisionPreview({ pageId, sha, onClose }: RevisionPreviewProps) {
  const revision = useRevision(pageId, sha ?? undefined);
  if (!sha) return null;

  const frontmatter = revision.data?.frontmatter;

  return (
    <Modal open title={`Revision ${shortSha(sha)}`} onClose={onClose} width="46rem">
      {revision.isLoading ? <p className="empty-note">Loading…</p> : null}
      {revision.isError ? <p className="empty-note">This revision cannot be read.</p> : null}
      {frontmatter ? (
        <div className="revision">
          <div className="revision__head">
            <span className="revision__title">
              {frontmatter.icon ? `${frontmatter.icon} ` : ''}
              {frontmatter.title}
            </span>
            <span className="faint">updated {absoluteTime(frontmatter.updated)}</span>
          </div>
          <pre className="revision__body">{revision.data?.markdown ?? ''}</pre>
        </div>
      ) : null}
    </Modal>
  );
}
