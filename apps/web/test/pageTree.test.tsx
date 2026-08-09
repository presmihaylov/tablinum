import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { TreeNode } from '@gitdocs/shared';
import { PageTree } from '../src/components/Sidebar/PageTree';
import { useContent } from '../src/lib/content';
import { installFetch, type MockServer } from './mockFetch';
import { node, page, space } from './fixtures';
import { renderApp } from './render';

const RUNBOOKS = node('eng/runbooks', { title: 'Runbooks', order: 10 });
const FAQ = node('eng/faq', { title: 'FAQ', order: 30 });
const ONCALL = node('ops/oncall', { title: 'On call', order: 5 });

let server: MockServer | null = null;

/** Shows how many spaces the provider holds, so a test never opens a menu too early. */
function SpacesProbe() {
  const { spaces } = useContent();
  return <div data-testid="spaces">{spaces.length}</div>;
}

function startServer(): MockServer {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [space('eng', [RUNBOOKS, FAQ]), space('ops', [ONCALL])] },
    [`PATCH /api/v1/pages/${FAQ.id}`]: { page: page({ id: FAQ.id, path: 'ops/faq', title: 'FAQ' }) },
  });
  return server;
}

async function showTree(nodes: TreeNode[]): Promise<void> {
  renderApp(
    <>
      <SpacesProbe />
      <PageTree
        nodes={nodes}
        expanded={new Set<string>()}
        currentPath=""
        onToggle={vi.fn()}
        onExpand={vi.fn()}
        onOpen={vi.fn()}
      />
    </>,
  );
  await waitFor(() => expect(screen.getByTestId('spaces').textContent).toBe('2'));
}

function openMenuOn(title: string): void {
  const row = screen.getByText(title).closest('.tree-row');
  if (!row) throw new Error(`No row for ${title}`);
  fireEvent.contextMenu(row);
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('move a page to another space', () => {
  it('moves the page with one PATCH', async () => {
    const mock = startServer();
    await showTree([RUNBOOKS, FAQ]);

    openMenuOn('FAQ');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to space' }));

    const option = await screen.findByRole('option', { name: /ops/ });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() => {
      const patch = mock.calls.find((call) => call.method === 'PATCH');
      expect(patch?.url.pathname).toBe(`/api/v1/pages/${FAQ.id}`);
      expect(patch?.body).toEqual({ order: 6, path: 'ops/faq' });
    });
  });

  it('opens the page in its new space, even when another page is on screen', async () => {
    startServer();
    await showTree([RUNBOOKS, FAQ]);

    openMenuOn('FAQ');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to space' }));
    fireEvent.click(await screen.findByRole('option', { name: /ops/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/p/ops/faq'));
  });

  it('offers every space except the one the page is in', async () => {
    startServer();
    await showTree([RUNBOOKS, FAQ]);

    openMenuOn('FAQ');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to space' }));

    const options = await screen.findAllByRole('option');
    expect(options.map((item) => item.textContent)).toEqual(['#ops']);
  });

  it('sends nothing when the dialog is cancelled', async () => {
    const mock = startServer();
    await showTree([RUNBOOKS, FAQ]);

    openMenuOn('FAQ');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to space' }));
    await screen.findByRole('option', { name: /ops/ });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(mock.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('never offers the move on a space home page', async () => {
    startServer();
    const home = node('eng', { title: 'Engineering', children: [FAQ] });
    await showTree([home]);

    openMenuOn('Engineering');
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Move to space' })).toBeNull();
  });
});
