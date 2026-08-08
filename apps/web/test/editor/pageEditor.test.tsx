import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Page } from '@gitdocs/shared';
import { PageEditor } from '../../src/editor';
import { fakeId, node, page, space } from '../fixtures';
import { installFetch, type MockServer } from '../mockFetch';
import { renderApp } from '../render';

let server: MockServer | null = null;

afterEach(() => {
  server?.restore();
  server = null;
});

interface Spies {
  onChange: ReturnType<typeof vi.fn>;
  onTitleChange: ReturnType<typeof vi.fn>;
}

/** Holds the page in state, so a test can hand the editor a new one. */
function Host({
  initial,
  spies,
  onReady,
}: {
  initial: Page;
  spies: Spies;
  onReady: (setPage: (next: Page) => void) => void;
}) {
  const [current, setCurrent] = useState(initial);
  useEffect(() => {
    onReady(setCurrent);
  }, [onReady]);
  return (
    <PageEditor
      page={current}
      onChange={spies.onChange}
      onTitleChange={spies.onTitleChange}
      saveState="idle"
    />
  );
}

interface Mounted {
  spies: Spies;
  setPage: (next: Page) => void;
}

async function mount(initial: Page): Promise<Mounted> {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [space('eng', [node('eng/deploy', { title: 'Deploy' })])] },
  });
  const spies: Spies = { onChange: vi.fn(), onTitleChange: vi.fn() };
  let setPage: ((next: Page) => void) | null = null;
  renderApp(<Host initial={initial} spies={spies} onReady={(setter) => (setPage = setter)} />);
  await waitFor(() => expect(setPage).not.toBeNull());
  const apply = setPage as unknown as (next: Page) => void;
  return { spies, setPage: (next) => act(() => apply(next)) };
}

function body(): HTMLElement {
  const element = document.querySelector('.gd-editor-surface');
  if (!(element instanceof HTMLElement)) throw new Error('the editor body is not mounted');
  return element;
}

describe('PageEditor', () => {
  it('shows the title and the body, and reports no change on load', async () => {
    const { spies } = await mount(
      page({ title: 'Deploy', markdown: '# Ship it\n\nA short paragraph.\n' }),
    );

    expect(screen.getByLabelText('Page title')).toHaveValue('Deploy');
    await waitFor(() => expect(body().textContent).toContain('A short paragraph.'));
    expect(body().querySelector('h1')?.textContent).toBe('Ship it');
    expect(spies.onChange).not.toHaveBeenCalled();
    expect(spies.onTitleChange).not.toHaveBeenCalled();
  });

  it('reports a title edit and leaves the markdown alone', async () => {
    const { spies } = await mount(page({ title: 'Deploy' }));

    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Deploy v2' } });

    expect(spies.onTitleChange).toHaveBeenCalledWith('Deploy v2');
    expect(screen.getByLabelText('Page title')).toHaveValue('Deploy v2');
    expect(spies.onChange).not.toHaveBeenCalled();
  });

  it('keeps a title on one line', async () => {
    const { spies } = await mount(page({ title: 'Deploy' }));

    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'One\nTwo' } });

    expect(spies.onTitleChange).toHaveBeenCalledWith('One Two');
  });

  it('loads the new document when the page id changes', async () => {
    const { setPage } = await mount(page({ title: 'Deploy', markdown: '# Ship it\n' }));
    await waitFor(() => expect(body().textContent).toContain('Ship it'));

    setPage(
      page({
        id: fakeId('rollback'),
        path: 'eng/rollback',
        title: 'Rollback',
        markdown: '# Undo it\n',
      }),
    );

    await waitFor(() => expect(body().textContent).toContain('Undo it'));
    expect(body().textContent).not.toContain('Ship it');
    expect(screen.getByLabelText('Page title')).toHaveValue('Rollback');
  });

  it('ignores markdown that arrives for the page already open', async () => {
    const first = page({ title: 'Deploy', markdown: '# Ship it\n' });
    const { setPage } = await mount(first);
    await waitFor(() => expect(body().textContent).toContain('Ship it'));

    // A save response must never overwrite what the person is typing.
    setPage({ ...first, markdown: '# Server copy\n' });

    expect(body().textContent).toContain('Ship it');
    expect(body().textContent).not.toContain('Server copy');
  });

  it('shows the page icon and the save state', async () => {
    await mount(page({ icon: '🚀' }));

    expect(screen.getByLabelText('Page icon').textContent).toBe('🚀');
    expect(document.querySelector('.save-indicator')?.textContent).toContain('Saved to git');
  });

  it('offers the slash prompt on an empty page', async () => {
    await mount(page({ title: 'Empty', markdown: '' }));

    await waitFor(() =>
      expect(body().querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe(
        'Type / for commands',
      ),
    );
  });
});
