import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { usePage } from '../api/hooks';
import { PageEditor } from '../editor';
import { pathFromSplat } from '../lib/href';
import { useAutosave } from '../lib/useAutosave';
import { PageMeta } from '../components/PageMeta/PageMeta';
import { NotFoundRoute } from './NotFoundRoute';

interface PageRouteProps {
  metaOpen: boolean;
}

/** Centre pane plus the details panel. Autosave lives here, not in the editor. */
export function PageRoute({ metaOpen }: PageRouteProps) {
  const params = useParams();
  const path = pathFromSplat(params['*']);
  const query = usePage(path);
  const page = query.data?.page;
  const autosave = useAutosave(page?.id);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void autosave.flush();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autosave]);

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
    <>
      <div className="app-content">
        <div className="page-shell">
          <PageEditor
            page={page}
            saveState={autosave.saveState}
            onChange={(markdown) => autosave.queue({ markdown })}
            onTitleChange={(title) => autosave.queue({ title })}
          />
        </div>
      </div>

      {metaOpen ? <PageMeta page={page} /> : null}
    </>
  );
}
