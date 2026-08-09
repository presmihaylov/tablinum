import { Navigate } from 'react-router-dom';
import { pageHref } from '../lib/href';
import { useContent } from '../lib/content';

/** Sends the user to the first page of the active space. */
export function HomeRoute() {
  const { spaces, currentSpace, isLoadingTree, newSpace, newPage } = useContent();

  if (isLoadingTree) {
    return (
      <div className="app-content">
        <div className="centered-state">
          <span className="spinner" />
        </div>
      </div>
    );
  }

  const space = spaces.find((candidate) => candidate.slug === currentSpace) ?? spaces[0];
  const first = space?.tree[0];

  if (space && first) return <Navigate to={pageHref(first.path)} replace />;

  return (
    <div className="app-content">
      <div className="centered-state">
        <h2>Welcome to gitdocs</h2>
        <p>Every page here is a markdown file with YAML frontmatter, tracked in git.</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {space ? (
            <button type="button" className="btn btn--primary" onClick={() => newPage(space.slug)}>
              Create the first page
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={newSpace}>
              Create a space
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
