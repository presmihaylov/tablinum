import { Link } from 'react-router-dom';
import { useContent } from '../lib/content';

interface NotFoundRouteProps {
  path?: string;
}

export function NotFoundRoute({ path }: NotFoundRouteProps) {
  const { newPage, currentSpace } = useContent();

  return (
    <div className="app-content">
      <div className="centered-state">
        <h2>Nothing here yet</h2>
        {path ? (
          <p>
            No page lives at <code>{path}</code>.
          </p>
        ) : (
          <p>That address does not match a page.</p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn--primary" onClick={() => newPage(currentSpace || null)}>
            Create a page
          </button>
          <Link className="btn btn--outline" to="/">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
