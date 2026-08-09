import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { SpaceSwitcher } from '../src/components/Sidebar/SpaceSwitcher';
import type { SpaceTree } from '../src/lib/tree';
import { installFetch, type MockServer } from './mockFetch';
import { node } from './fixtures';
import { renderApp } from './render';

const RUNBOOKS = node('eng/runbooks', { title: 'Runbooks' });
const ENG: SpaceTree = { slug: 'eng', name: 'Engineering', tree: [RUNBOOKS] };

let server: MockServer | null = null;

function startServer(): MockServer {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [ENG] },
    'POST /api/v1/spaces': { space: { slug: 'ops', name: 'Operations', icon: '🚀' } },
    'PATCH /api/v1/spaces/eng': { space: { slug: 'eng', name: 'Platform', icon: '🚀' } },
  });
  return server;
}

async function showSwitcher(): Promise<void> {
  renderApp(<SpaceSwitcher />);
  await waitFor(() => expect(screen.getByText('Engineering')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /Engineering/ }));
}

function typeIn(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => {
  server?.restore();
  server = null;
});

describe('create a space', () => {
  it('sends the name and the icon, then opens the new space', async () => {
    const mock = startServer();
    await showSwitcher();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'New space' }));
    typeIn('Space name', 'Operations');
    typeIn('Search icons', 'rocket');
    fireEvent.click(await screen.findByRole('option', { name: 'rocket' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = mock.calls.find((call) => call.method === 'POST');
      expect(post?.url.pathname).toBe('/api/v1/spaces');
      expect(post?.body).toEqual({ slug: 'operations', name: 'Operations', icon: '🚀' });
    });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/p/ops'));
  });

  it('sends no icon when none is picked', async () => {
    const mock = startServer();
    await showSwitcher();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'New space' }));
    typeIn('Space name', 'Operations');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = mock.calls.find((call) => call.method === 'POST');
      expect(post?.body).toEqual({ slug: 'operations', name: 'Operations' });
    });
  });
});

describe('edit a space', () => {
  it('patches the name and the icon of the open space', async () => {
    const mock = startServer();
    await showSwitcher();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit space' }));
    expect(screen.getByLabelText('Space name')).toHaveValue('Engineering');

    typeIn('Space name', 'Platform');
    typeIn('Search icons', 'rocket');
    fireEvent.click(await screen.findByRole('option', { name: 'rocket' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = mock.calls.find((call) => call.method === 'PATCH');
      expect(patch?.url.pathname).toBe('/api/v1/spaces/eng');
      expect(patch?.body).toEqual({ name: 'Platform', icon: '🚀' });
    });
  });

  it('clears the icon when the person removes it', async () => {
    const mock = startServer();
    await showSwitcher();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit space' }));
    typeIn('Search icons', 'rocket');
    fireEvent.click(await screen.findByRole('option', { name: 'rocket' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = mock.calls.find((call) => call.method === 'PATCH');
      expect(patch?.body).toEqual({ name: 'Engineering', icon: null });
    });
  });
});
