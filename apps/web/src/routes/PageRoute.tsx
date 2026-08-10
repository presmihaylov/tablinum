import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { usePage } from '../api/hooks';
import { PageEditor } from '../editor';
import { pathFromSplat } from '../lib/href';
import { usePageDoc } from '../lib/usePageDoc';
import { anyPanelOpen, type PanelState } from '../lib/panels';
import { CommentsProvider } from '../lib/comments';
import { CommentsAside } from '../components/Comments/CommentsPanel';
import { ConflictDialog } from '../components/Conflict/ConflictDialog';
import { DatabaseView } from '../components/Database/DatabaseView';
import { PageMeta } from '../components/PageMeta/PageMeta';
import { NotFoundRoute } from './NotFoundRoute';

interface PageRouteProps {
  panels: PanelState;
  onClosePanels: () => void;
}

/** Centre pane plus the details panel. Autosave lives here, not in the editor. */
export function PageRoute({ panels, onClosePanels }: PageRouteProps) {
  const params = useParams();
  const path = pathFromSplat(params['*']);
  const query = usePage(path);
  const page = query.data?.page;
  const doc = usePageDoc(page);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void doc.flush();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc]);

  if (query.isLoading) {
    return (
      <div className="app-content">
        <div className="centered-state">
          <span className="spinner" />
        </div>
      </div>
    );
  }

  if (!page) {
    if (query.error?.status === 404) return <NotFoundRoute path={path} />;
    return (
      <div className="app-content">
        <div className="centered-state">
          <h2>This page cannot be loaded</h2>
          <p>{query.error?.message ?? 'Unknown error.'}</p>
        </div>
      </div>
    );
  }

  return (
    // Keyed on the page: a thread in focus, a draft and a panel state all belong to one page.
    <CommentsProvider key={page.id} pageId={page.id}>
      <div className="app-content">
        <div className={`page-shell${page.database ? ' page-shell--database' : ''}`}>
          <PageEditor
            page={page}
            saveState={doc.saveState}
            incoming={doc.incoming}
            room={doc.room}
            onChange={doc.queueMarkdown}
            onTitleChange={doc.queueTitle}
            onIconChange={doc.queueIcon}
          />
          {page.database ? <DatabaseView page={page} /> : null}
        </div>
      </div>

      <CommentsAside />

      {anyPanelOpen(panels) ? (
        <PageMeta page={page} panels={panels} onClose={onClosePanels} />
      ) : null}

      <ConflictDialog conflict={doc.conflict} onResolve={doc.resolveConflict} />
    </CommentsProvider>
  );
}
