import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Account } from '@tablinum/shared';
import { Sidebar } from '../src/components/Sidebar/Sidebar';
import { AuthProvider } from '../src/lib/auth';
import { installFetch, type MockServer, type Routes as MockRoutes } from './mockFetch';
import { node, space } from './fixtures';
import { renderApp } from './render';

/**
 * The Recents bucket. A page enters at the top the first time it is opened and never moves
 * again, and the list belongs to the person who is signed in, not to the browser.
 */

const ADA: Account = {
  id: 'us_00000000000000000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  handle: 'ada.lovelace',
  role: 'admin',
  color: '#3b82f6',
  avatarRev: null,
  disabled: false,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
};

const RUNBOOKS = node('eng/runbooks', { title: 'Runbooks' });
const FAQ = node('eng/faq', { title: 'FAQ' });
const ONCALL = node('eng/oncall', { title: 'Oncall' });

let server: MockServer | null = null;

function start(routes: MockRoutes = {}): MockServer {
  server = installFetch({
    'GET /api/v1/auth/state': { user: ADA, setupRequired: false },
    'GET /api/v1/workspaces': { workspaces: [], current: null },
    'GET /api/v1/tree': { spaces: [space('eng', [RUNBOOKS, FAQ, ONCALL])] },
    'GET /api/v1/favorites': { favorites: [] },
    ...routes,
  });
  return server;
}

function showSidebar(): void {
  renderApp(
    <AuthProvider>
      <Sidebar onOpenPalette={vi.fn()} onCollapse={vi.fn()} />
    </AuthProvider>,
  );
}

function bucket(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

/** Open a page from the tree, which is what puts it in Recents. A row is a div, not a button. */
async function openFromTree(title: string): Promise<void> {
  await userEvent.click(within(bucket('Spaces')).getByText(title, { exact: true }));
}

async function waitForTree(): Promise<void> {
  await within(bucket('Spaces')).findByText('Runbooks', { exact: true });
}

function recentTitles(): string[] {
  return within(bucket('Recents'))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('the recents bucket', () => {
  it('says so before any page is opened', async () => {
    start();
    showSidebar();

    expect(await within(bucket('Recents')).findByText('No pages opened yet.')).toBeInTheDocument();
  });

  it('puts a page at the top the first time it is opened', async () => {
    start();
    showSidebar();
    await waitForTree();

    await openFromTree('Runbooks');
    await openFromTree('FAQ');

    await waitFor(() => expect(recentTitles()).toEqual(['FAQ', 'Runbooks']));
  });

  it('leaves a page where it stands when it is opened again', async () => {
    start();
    showSidebar();
    await waitForTree();

    await openFromTree('Runbooks');
    await openFromTree('FAQ');
    await openFromTree('Oncall');
    await waitFor(() => expect(recentTitles()).toEqual(['Oncall', 'FAQ', 'Runbooks']));

    await openFromTree('Runbooks');

    // The order is untouched, and the row of the open page is the one that is lit.
    expect(recentTitles()).toEqual(['Oncall', 'FAQ', 'Runbooks']);
    const lit = within(bucket('Recents')).getAllByRole('button', { current: 'page' });
    expect(lit.map((one) => one.textContent)).toEqual(['Runbooks']);
  });

  it('stores the list under the person who is signed in', async () => {
    start();
    showSidebar();
    await waitForTree();

    await openFromTree('Runbooks');
    await waitFor(() => expect(recentTitles()).toEqual(['Runbooks']));

    // Nobody else who signs in on this browser reads this key.
    expect(window.localStorage.getItem(`tablinum.recents.${ADA.id}`)).toBe('["eng/runbooks"]');
    expect(window.localStorage.getItem('tablinum.recents')).toBeNull();
  });

  it('never reads the list a browser used to share', async () => {
    window.localStorage.setItem('tablinum.recents', '["eng/faq"]');
    start();
    showSidebar();

    expect(await within(bucket('Recents')).findByText('No pages opened yet.')).toBeInTheDocument();
    expect(window.localStorage.getItem('tablinum.recents')).toBeNull();
  });
});
