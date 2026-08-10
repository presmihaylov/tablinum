import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Page } from '@tablinum/shared';
import { PageMeta } from '../src/components/PageMeta/PageMeta';
import { TopBar } from '../src/components/TopBar/TopBar';
import type { SpaceTree } from '../src/lib/tree';
import { anyPanelOpen, NO_PANELS, type PanelId, type PanelState } from '../src/lib/panels';
import { installFetch, type MockServer, type Routes as MockRoutes } from './mockFetch';
import { renderApp } from './render';

const PAGE_ID = 'pg_00000000000000000000000001';

const PAGE: Page = {
  id: PAGE_ID,
  path: 'notes/weekly',
  space: 'notes',
  title: 'Weekly',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-02T00:00:00.000Z',
  markdown: 'Every Friday.\n',
  rev: 'r1',
  filePath: '/content/notes/weekly.md',
  hasChildren: false,
};

const TREE: SpaceTree[] = [
  {
    slug: 'notes',
    name: 'Notes',
    tree: [
      {
        id: 'pg_00000000000000000000000002',
        path: 'notes',
        title: 'Notes',
        children: [{ id: PAGE_ID, path: 'notes/weekly', title: 'Weekly', children: [] }],
      },
    ],
  },
  { slug: 'archive', name: 'Archive', tree: [] },
];

let server: MockServer | null = null;

function start(routes: MockRoutes = {}): MockServer {
  server = installFetch({
    'GET /api/v1/workspaces': { workspaces: [], current: null },
    'GET /api/v1/tree': { spaces: TREE },
    'GET /api/v1/pages': { page: PAGE },
    [`GET /api/v1/pages/${PAGE_ID}/backlinks`]: { backlinks: [] },
    [`GET /api/v1/pages/${PAGE_ID}/history`]: { entries: [] },
    ...routes,
  });
  return server;
}

/** The top bar and the rail read the same state, exactly as the shell wires them. */
function Harness() {
  const [panels, setPanels] = useState<PanelState>(NO_PANELS);
  const toggle = (id: PanelId): void => setPanels((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <>
      <TopBar
        sidebarOpen
        panels={panels}
        onToggleSidebar={vi.fn()}
        onTogglePanel={toggle}
        onOpenPalette={vi.fn()}
      />
      {anyPanelOpen(panels) ? (
        <PageMeta page={PAGE} panels={panels} onClose={() => setPanels(NO_PANELS)} />
      ) : null}
    </>
  );
}

async function openMenu(): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Page options' }));
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('the page menu', () => {
  it('holds the two panels and the page actions, and nothing else', async () => {
    start();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await openMenu();

    await waitFor(() =>
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Backlinks',
        'History',
        'Move to',
        'Delete',
      ]),
    );
  });

  it('keeps the rail off the page until the menu asks for it', async () => {
    start();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await screen.findByRole('button', { name: 'Page options' });
    expect(screen.queryByRole('complementary', { name: 'Page details' })).toBeNull();
  });

  it('opens the backlinks, then puts them away again', async () => {
    start();
    const user = userEvent.setup();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Backlinks' }));

    const rail = await screen.findByRole('complementary', { name: 'Page details' });
    expect(await screen.findByRole('region', { name: 'Backlinks' })).toBeInTheDocument();
    expect(rail).toBeInTheDocument();

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Backlinks' }));

    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Page details' })).toBeNull());
  });

  it('opens the history beside the backlinks', async () => {
    start();
    const user = userEvent.setup();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'History' }));

    expect(await screen.findByRole('region', { name: 'History' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Backlinks' })).toBeNull();
  });

  it('puts the rail away from the rail itself', async () => {
    start();
    const user = userEvent.setup();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'History' }));
    await screen.findByRole('complementary', { name: 'Page details' });

    await user.click(screen.getByRole('button', { name: 'Hide the page details' }));

    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Page details' })).toBeNull());
  });

  it('puts the rail away on Escape, and takes both panels with it', async () => {
    start();
    const user = userEvent.setup();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Backlinks' }));
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'History' }));
    await screen.findByRole('region', { name: 'History' });

    // Escape is bound to the rail, so it only counts while the focus is inside it.
    screen.getByRole('button', { name: 'Hide the page details' }).focus();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Page details' })).toBeNull());
    expect(screen.queryByRole('region', { name: 'Backlinks' })).toBeNull();
  });

  // A database now comes from the /Database and /Board slash commands, so the page menu no
  // longer converts a whole page into one.
  it('offers no way to turn the page into a database', async () => {
    start();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await openMenu();

    await screen.findByRole('menuitem', { name: 'Backlinks' });
    expect(screen.queryByRole('menuitem', { name: /database/i })).toBeNull();
  });

  it('asks before it deletes the page', async () => {
    const mock = start({ [`DELETE /api/v1/pages/${PAGE_ID}`]: { ok: true } });
    const user = userEvent.setup();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(await screen.findByText(/Delete "Weekly"\?/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const sent = mock.calls.find((call) => call.method === 'DELETE');
      expect(sent?.url.pathname).toBe(`/api/v1/pages/${PAGE_ID}`);
    });
  });

  it('offers the other spaces to move the page to', async () => {
    start();
    const user = userEvent.setup();
    renderApp(<Harness />, { route: '/p/notes/weekly' });

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Move to' }));

    expect(await screen.findByText('Move "Weekly" to')).toBeInTheDocument();
    // Only the space the page is not already in is on offer.
    expect(screen.getByText('Archive')).toBeInTheDocument();
  });

  it('leaves the page actions out when no page is open', async () => {
    start();
    renderApp(<Harness />, { route: '/' });

    await openMenu();

    await waitFor(() =>
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Backlinks',
        'History',
      ]),
    );
  });
});
