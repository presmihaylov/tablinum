import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../src/components/Sidebar/Sidebar';
import { AuthProvider } from '../src/lib/auth';
import { installFetch, type MockServer, type Routes as MockRoutes } from './mockFetch';
import { node, space } from './fixtures';
import { renderApp } from './render';

const RUNBOOKS = node('eng/runbooks', { title: 'Runbooks' });
const FAQ = node('eng/faq', { title: 'FAQ' });

let server: MockServer | null = null;

function start(routes: MockRoutes = {}): MockServer {
  server = installFetch({
    'GET /api/v1/workspaces': { workspaces: [], current: null },
    'GET /api/v1/tree': { spaces: [space('eng', [RUNBOOKS, FAQ])] },
    'GET /api/v1/favorites': { favorites: [] },
    ...routes,
  });
  return server;
}

function pinned(...ids: string[]): MockRoutes {
  return {
    'GET /api/v1/favorites': {
      favorites: ids.map((pageId, index) => ({
        pageId,
        created: `2026-01-0${index + 1}T00:00:00.000Z`,
      })),
    },
  };
}

function showSidebar(): void {
  renderApp(
    <AuthProvider>
      <Sidebar onOpenPalette={vi.fn()} onCollapse={vi.fn()} />
    </AuthProvider>,
  );
}

/** The Favorites bucket alone, so a page name in the tree below cannot be mistaken for a pin. */
function bucket(): HTMLElement {
  return screen.getByRole('region', { name: 'Favorites' });
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('the favorites bucket', () => {
  it('says so when nothing is pinned', async () => {
    start();
    showSidebar();

    expect(await within(bucket()).findByText('No favorites yet.')).toBeInTheDocument();
  });

  it('lists the pinned pages, oldest pin first', async () => {
    start(pinned(FAQ.id, RUNBOOKS.id));
    showSidebar();

    await waitFor(() =>
      expect(within(bucket()).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'FAQ',
        'Runbooks',
      ]),
    );
  });

  it('sits above the Spaces bucket', async () => {
    start();
    showSidebar();

    await screen.findByRole('region', { name: 'Favorites' });
    const labels = screen.getAllByRole('region').map((one) => one.getAttribute('aria-label'));
    expect(labels).toEqual(['Favorites', 'Spaces', 'Recents', 'Private']);
  });

  it('leaves out a pin whose page is gone', async () => {
    start(pinned('pg_00000000000000000000000009'));
    showSidebar();

    expect(await within(bucket()).findByText('No favorites yet.')).toBeInTheDocument();
  });

  it('takes the pin off with one DELETE', async () => {
    const mock = start({
      ...pinned(FAQ.id),
      [`DELETE /api/v1/favorites/${FAQ.id}`]: { ok: true },
    });
    const user = userEvent.setup();
    showSidebar();

    await user.click(await within(bucket()).findByRole('button', { name: 'Remove FAQ from favorites' }));

    await waitFor(() => {
      const sent = mock.calls.find((call) => call.method === 'DELETE');
      expect(sent?.url.pathname).toBe(`/api/v1/favorites/${FAQ.id}`);
    });
  });

  it('opens the page when the row is clicked', async () => {
    start(pinned(FAQ.id));
    const user = userEvent.setup();
    showSidebar();

    await user.click(await within(bucket()).findByRole('button', { name: 'FAQ' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/p/eng/faq'));
  });

  it('folds the bucket away and back', async () => {
    start(pinned(FAQ.id));
    const user = userEvent.setup();
    showSidebar();

    await within(bucket()).findByText('FAQ');
    await user.click(within(bucket()).getByRole('button', { name: 'Favorites' }));

    await waitFor(() => expect(within(bucket()).queryByText('FAQ')).toBeNull());

    await user.click(within(bucket()).getByRole('button', { name: 'Favorites' }));
    expect(await within(bucket()).findByText('FAQ')).toBeInTheDocument();
  });
});
