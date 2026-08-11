import { Navigate } from 'react-router-dom';
import { pageHref } from '../lib/href';
import { useContent } from '../lib/content';
import { useAuth } from '../lib/auth';

/** Sends the user to the first page of the active space. */
export function HomeRoute() {
  const { spaces, currentSpace, isLoadingTree, newSpace, newPage } = useContent();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

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

  // A member cannot create a shared space, so offering one here is a dead end. Their own private
  // space is still theirs to make, and that is the only way out of this screen they have.
  if (!space && !isAdmin) {
    return (
      <div className="app-content">
        <div className="centered-state">
          <h2>Welcome to tablinum</h2>
          <p>No space is shared with you yet. An admin has to create one.</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => newSpace({ private: true })}
            >
              New private space
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-content">
      <div className="centered-state">
        <h2>Welcome to tablinum</h2>
        <p>Every page here is a markdown file with YAML frontmatter, tracked in git.</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {space ? (
            <button type="button" className="btn btn--primary" onClick={() => newPage(space.slug)}>
              Create the first page
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => newSpace()}>
              Create a space
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
