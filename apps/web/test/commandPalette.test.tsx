import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Account, SearchHit } from '@tablinum/shared';
import { CommandPalette } from '../src/components/CommandPalette/CommandPalette';
import { AuthProvider } from '../src/lib/auth';
import { filterActions, scoreMatch } from '../src/lib/palette';
import { useDebouncedValue } from '../src/lib/useDebouncedValue';
import { installFetch, type MockServer, type Routes as MockRoutes } from './mockFetch';
import { fakeId, node, space } from './fixtures';
import { renderApp } from './render';

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

/** The rows an anybody sees on the home route: no page is open and nobody is signed in. */
const BASE_ROWS = [
  'New page',
  'New space',
  'New private space',
  'Sync with git',
  'Toggle theme',
  'Go home',
  'My account',
  'Custom emoji',
  'Workspace settings',
];

const HITS: SearchHit[] = [
  { id: fakeId('deploy'), path: 'eng/runbooks/deploy', title: 'Deploy runbook', snippet: 'How to ship', score: 1 },
  {
    id: fakeId('rollback'),
    path: 'eng/runbooks/rollback',
    title: 'Rollback runbook',
    snippet: 'How to undo',
    score: 0.6,
  },
];

let server: MockServer | null = null;

function startServer(routes: MockRoutes = {}): MockServer {
  server = installFetch({
    'GET /api/v1/tree': {
      spaces: [space('eng', [node('eng/runbooks', { title: 'Runbooks' })])],
    },
    'GET /api/v1/favorites': { favorites: [] },
    ...routes,
    'GET /api/v1/search': (url) => {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      return { hits: HITS.filter((hit) => hit.title.toLowerCase().includes(q)) };
    },
  });
  return server;
}

function rowLabels(): string[] {
  return screen
    .queryAllByRole('option')
    .map((row) => row.querySelector('.palette__label')?.textContent ?? '');
}

function selectedLabel(): string | null {
  const row = screen.queryAllByRole('option').find((item) => item.getAttribute('aria-selected') === 'true');
  return row?.querySelector('.palette__label')?.textContent ?? null;
}

async function openPalette(
  onClose: () => void = vi.fn(),
  route = '/',
): Promise<{ user: ReturnType<typeof userEvent.setup>; input: HTMLElement }> {
  const user = userEvent.setup();
  renderApp(
    <AuthProvider>
      <CommandPalette open onClose={onClose} />
    </AuthProvider>,
    { route },
  );
  const input = await screen.findByRole('combobox');
  await waitFor(() => expect(input).toHaveFocus());
  return { user, input };
}

/** Opens and closes the palette from outside, the way the shell does. */
function Toggler() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen((current) => !current)}>
        Toggle the palette
      </button>
      <AuthProvider>
        <CommandPalette open={open} onClose={() => setOpen(false)} />
      </AuthProvider>
    </>
  );
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('filterActions', () => {
  const actions = [
    { label: 'New page', keywords: ['create', 'add'] },
    { label: 'Sync with git', keywords: ['pull', 'push'] },
    { label: 'Toggle theme', keywords: ['dark', 'light'] },
  ];

  it('keeps the given order for an empty query', () => {
    expect(filterActions(actions, '   ').map((a) => a.label)).toEqual([
      'New page',
      'Sync with git',
      'Toggle theme',
    ]);
  });

  it('drops rows that do not match at all', () => {
    expect(filterActions(actions, 'theme').map((a) => a.label)).toEqual(['Toggle theme']);
    expect(filterActions(actions, 'zzzz')).toEqual([]);
  });

  it('matches a keyword as well as the label', () => {
    expect(filterActions(actions, 'push').map((a) => a.label)).toEqual(['Sync with git']);
    expect(filterActions(actions, 'dark').map((a) => a.label)).toEqual(['Toggle theme']);
  });

  it('ranks a prefix above a mid-word hit', () => {
    const rows = filterActions([{ label: 'Rebuild page' }, { label: 'Page settings' }], 'page');
    expect(rows.map((row) => row.label)).toEqual(['Page settings', 'Rebuild page']);
  });

  it('scores exact above prefix above a loose subsequence', () => {
    const exact = scoreMatch('sync', 'sync') ?? 0;
    const prefix = scoreMatch('sync with git', 'sync') ?? 0;
    const loose = scoreMatch('sync with git', 'sgt') ?? 0;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(loose);
    expect(scoreMatch('sync with git', 'qqq')).toBeNull();
  });
});

describe('useDebouncedValue', () => {
  it('settles only after the input stops changing', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 160), {
      initialProps: { value: 'r' },
    });

    for (const value of ['ru', 'run', 'runb', 'runbook']) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(result.current).toBe('r');
    }

    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(result.current).toBe('runbook');
    vi.useRealTimers();
  });
});

describe('CommandPalette', () => {
  it('lists the quick actions when it opens', async () => {
    startServer();
    await openPalette();

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(rowLabels()).toEqual(BASE_ROWS);
  });

  it('offers the page actions while a page is open, and not before', async () => {
    startServer();
    await openPalette(vi.fn(), '/p/eng/runbooks');

    await waitFor(() =>
      expect(rowLabels()).toContain('Copy link to the page'),
    );
    expect(rowLabels()).toEqual([
      'New page',
      'New space',
      'New private space',
      'Sync with git',
      'Toggle theme',
      'Add to favorites',
      'Copy link to the page',
      'Rename the page',
      'Duplicate the page',
      'Move the page to another space',
      'Delete the page',
      'Go home',
      'My account',
      'Custom emoji',
      'Workspace settings',
    ]);
  });

  it('finds the invites under the workspace section, which now holds them', async () => {
    startServer({ 'GET /api/v1/auth/state': { setupRequired: false, user: ADA } });
    const { user, input } = await openPalette();

    await user.type(input, 'invites');

    await waitFor(() => expect(rowLabels()).toEqual(['Workspace settings']));
  });

  it('offers the agent screen to an admin', async () => {
    startServer({ 'GET /api/v1/auth/state': { setupRequired: false, user: ADA } });
    const { user, input } = await openPalette();

    await user.type(input, 'agents');

    await waitFor(() => expect(rowLabels()).toContain('Agents'));
  });

  it('keeps the admin sections away from everybody else', async () => {
    startServer({
      'GET /api/v1/auth/state': { setupRequired: false, user: { ...ADA, role: 'member' } },
    });
    const { user, input } = await openPalette();

    await user.type(input, 'agents');

    await waitFor(() => expect(rowLabels()).not.toContain('Agents'));
  });

  it('runs a page action on the page that is open', async () => {
    startServer();
    const { user, input } = await openPalette(vi.fn(), '/p/eng/runbooks');
    await waitFor(() => expect(rowLabels()).toContain('Rename the page'));

    await user.type(input, 'rename');
    await waitFor(() => expect(rowLabels()).toEqual(['Rename the page']));
    await user.click(screen.getByRole('option', { name: /Rename the page/ }));

    expect(await screen.findByRole('dialog', { name: 'Rename page' })).toBeInTheDocument();
  });

  it('filters the quick actions as the user types', async () => {
    startServer();
    const { user, input } = await openPalette();

    await user.type(input, 'theme');

    await waitFor(() => expect(rowLabels()).toEqual(['Toggle theme']));
  });

  it('shows search hits and hides the actions that do not match', async () => {
    startServer();
    const { user, input } = await openPalette();

    await user.type(input, 'runbook');

    await waitFor(() => expect(rowLabels()).toEqual(['Deploy runbook', 'Rollback runbook']));
  });

  it('sends the settled query to the search endpoint', async () => {
    const mock = startServer();
    const { user, input } = await openPalette();

    await user.type(input, 'runbook');
    await waitFor(() => expect(rowLabels()).toEqual(['Deploy runbook', 'Rollback runbook']));

    const searchCalls = mock.calls.filter((call) => call.url.pathname === '/api/v1/search');
    expect(searchCalls.length).toBeGreaterThan(0);
    expect(searchCalls.at(-1)?.url.searchParams.get('q')).toBe('runbook');
    expect(searchCalls.at(-1)?.url.searchParams.get('limit')).toBe('12');
  });

  it('reports no matches when nothing scores', async () => {
    startServer();
    const { user, input } = await openPalette();

    await user.type(input, 'zzqqxx');

    await waitFor(() => expect(screen.getByText('No matches.')).toBeInTheDocument());
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('moves the selection with the arrow keys and wraps around', async () => {
    startServer();
    const { user } = await openPalette();

    expect(selectedLabel()).toBe('New page');
    await user.keyboard('{ArrowDown}');
    expect(selectedLabel()).toBe('New space');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(selectedLabel()).toBe(BASE_ROWS.at(-1));
  });

  it('opens the highlighted page on Enter and closes itself', async () => {
    startServer();
    const onClose = vi.fn();
    const { user, input } = await openPalette(onClose);

    await user.type(input, 'runbook');
    await waitFor(() => expect(rowLabels()).toEqual(['Deploy runbook', 'Rollback runbook']));

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/p/eng/runbooks/rollback'));
  });

  it('closes on Escape', async () => {
    startServer();
    const onClose = vi.fn();
    const { user } = await openPalette(onClose);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    startServer();
    renderApp(
      <AuthProvider>
        <CommandPalette open={false} onClose={vi.fn()} />
      </AuthProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts empty again after it is closed and reopened', async () => {
    startServer();
    const user = userEvent.setup();
    // The reset runs on the way out. The way in must leave the field alone, or the first
    // keys of a fast typist are wiped when React flushes the effect after the paint.
    renderApp(<Toggler />);
    const input = await screen.findByRole('combobox');
    await user.type(input, 'runbook');
    await waitFor(() => expect(rowLabels()).toEqual(['Deploy runbook', 'Rollback runbook']));

    const toggle = screen.getByRole('button', { name: 'Toggle the palette' });
    await user.click(toggle);
    await user.click(toggle);

    expect(await screen.findByRole('combobox')).toHaveValue('');
    await waitFor(() => expect(rowLabels()).toEqual(BASE_ROWS));
  });
});
