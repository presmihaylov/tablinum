import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Page } from '@tablinum/shared';
import { PageEditor } from '../../src/editor';
import { fakeId, node, page, space } from '../fixtures';
import { installFetch, type MockServer, type Routes } from '../mockFetch';
import { renderApp } from '../render';

let server: MockServer | null = null;

afterEach(() => {
  server?.restore();
  server = null;
});

interface Spies {
  onChange: ReturnType<typeof vi.fn>;
  onTitleChange: ReturnType<typeof vi.fn>;
  onIconChange: ReturnType<typeof vi.fn>;
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
      onIconChange={spies.onIconChange}
      saveState="idle"
    />
  );
}

interface Mounted {
  spies: Spies;
  setPage: (next: Page) => void;
}

async function mount(initial: Page, routes: Routes = {}): Promise<Mounted> {
  server = installFetch({
    'GET /api/v1/tree': { spaces: [space('eng', [node('eng/deploy', { title: 'Deploy' })])] },
    ...routes,
  });
  const spies: Spies = { onChange: vi.fn(), onTitleChange: vi.fn(), onIconChange: vi.fn() };
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

  it('offers emoji in the title when a colon is typed', async () => {
    const { spies } = await mount(page({ title: 'Deploy' }));

    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Deploy :roc' } });

    fireEvent.click(await screen.findByRole('option', { name: /rocket/ }));

    await waitFor(() => expect(screen.getByLabelText('Page title')).toHaveValue('Deploy 🚀'));
    expect(spies.onTitleChange).toHaveBeenLastCalledWith('Deploy 🚀');
  });

  it('picks a title emoji with the arrow keys and Enter', async () => {
    await mount(page({ title: 'Deploy' }));
    const field = screen.getByLabelText('Page title');

    fireEvent.change(field, { target: { value: ':cha' } });
    await screen.findByRole('option', { name: /chart up/ });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(field).toHaveValue('📉'));
  });

  it('leaves a colon in the title alone when it names no emoji', async () => {
    await mount(page({ title: 'Deploy' }));

    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Ship at 10:30' } });

    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByLabelText('Page title')).toHaveValue('Ship at 10:30');
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

  it('picks a new page icon from the emoji picker', async () => {
    const { spies } = await mount(page({ icon: '\u{1F680}' }));

    fireEvent.click(screen.getByLabelText('Page icon'));
    expect(screen.getByRole('dialog', { name: 'Choose a page icon' })).toBeTruthy();

    fireEvent.click(screen.getByLabelText('party popper'));

    expect(spies.onIconChange).toHaveBeenCalledWith('\u{1F389}');
    expect(screen.getByLabelText('Page icon').textContent).toBe('\u{1F389}');
    expect(screen.queryByRole('dialog', { name: 'Choose a page icon' })).toBeNull();
    expect(spies.onChange).not.toHaveBeenCalled();
  });

  it('offers an icon on a page that has none', async () => {
    const { spies } = await mount(page({}));

    expect(screen.queryByLabelText('Page icon')).toBeNull();
    fireEvent.click(screen.getByLabelText('Add an icon'));
    fireEvent.click(screen.getByLabelText('rocket'));

    expect(spies.onIconChange).toHaveBeenCalledWith('\u{1F680}');
    expect(screen.getByLabelText('Page icon').textContent).toBe('\u{1F680}');
  });

  it('removes the icon, and only offers that when there is one', async () => {
    const { spies } = await mount(page({}));

    fireEvent.click(screen.getByLabelText('Add an icon'));
    expect(screen.queryByText('Remove')).toBeNull();
    fireEvent.click(screen.getByLabelText('rocket'));

    fireEvent.click(screen.getByLabelText('Page icon'));
    fireEvent.click(screen.getByText('Remove'));

    expect(spies.onIconChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByLabelText('Page icon')).toBeNull();
    expect(screen.getByLabelText('Add an icon')).toBeTruthy();
  });

  it('closes the icon picker on a second click of the icon', async () => {
    await mount(page({ icon: '\u{1F680}' }));

    fireEvent.click(screen.getByLabelText('Page icon'));
    expect(screen.getByRole('dialog', { name: 'Choose a page icon' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Page icon' }));
    expect(screen.queryByRole('dialog', { name: 'Choose a page icon' })).toBeNull();
  });

  it('plays a video embed instead of showing its markup', async () => {
    const frame =
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="YouTube" allowfullscreen></iframe>';
    const { spies } = await mount(page({ markdown: `${frame}\n` }));

    await waitFor(() => expect(document.querySelector('.gd-editor-embed__player')).not.toBeNull());
    const player = document.querySelector('.gd-editor-embed__player');
    expect(player?.tagName).toBe('IFRAME');
    expect(player?.getAttribute('src')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(spies.onChange).not.toHaveBeenCalled();
  });

  it('leaves other raw HTML as its own source', async () => {
    await mount(page({ markdown: '<div align="center">raw</div>\n' }));

    await waitFor(() =>
      expect(document.querySelector('.gd-editor-html--block')?.textContent).toBe(
        '<div align="center">raw</div>',
      ),
    );
    expect(document.querySelector('.gd-editor-embed__player')).toBeNull();
  });

  it('shows an embedded page as its icon and title', async () => {
    const embedded = page({
      id: fakeId('runbook'),
      path: 'eng/deploy',
      title: 'Deploy runbook',
      icon: '🚀',
      markdown: '# Steps\n\nPull, then push.\n',
    });
    const { spies } = await mount(page({ path: 'eng/plan', markdown: '![[eng/deploy]]\n' }), {
      'GET /api/v1/pages': () => ({ page: embedded }),
    });

    await waitFor(() =>
      expect(document.querySelector('.gd-editor-pageembed__title')?.textContent).toBe(
        'Deploy runbook',
      ),
    );
    expect(document.querySelector('.gd-editor-pageembed__icon')?.textContent).toBe('🚀');
    // The body of the other page stays out of this document.
    expect(body().textContent).not.toContain('Pull, then push.');
    expect(spies.onChange).not.toHaveBeenCalled();
  });

  it('opens the embedded page when it is clicked', async () => {
    const embedded = page({ id: fakeId('runbook'), path: 'eng/deploy', title: 'Deploy runbook' });
    await mount(page({ path: 'eng/plan', markdown: '![[eng/deploy]]\n' }), {
      'GET /api/v1/pages': () => ({ page: embedded }),
    });

    await waitFor(() => expect(document.querySelector('.gd-editor-pageembed__link')).not.toBeNull());
    fireEvent.click(document.querySelector('.gd-editor-pageembed__link') as HTMLElement);

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/p/eng/deploy'),
    );
  });

  it('marks a target with no page behind it', async () => {
    await mount(page({ path: 'eng/plan', markdown: '![[eng/gone]]\n' }));

    await waitFor(() =>
      expect(document.querySelector('.gd-editor-pageembed__link')?.className).toContain(
        'is-missing',
      ),
    );
    expect(document.querySelector('.gd-editor-pageembed__title')?.textContent).toBe('eng/gone');
  });

  it('keeps the block handles up while the pointer travels to them', async () => {
    await mount(page({ markdown: 'One line.\n' }));
    await waitFor(() => expect(body().textContent).toContain('One line.'));

    fireEvent.mouseMove(body().querySelector('p') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.gd-editor-handles')).not.toBeNull());

    // Both the gutter and the buttons themselves sit outside the editable box.
    fireEvent.mouseMove(document.querySelector('.editor__canvas') as HTMLElement);
    fireEvent.mouseMove(document.querySelector('.gd-editor-handles__btn--grip') as HTMLElement);

    expect(document.querySelector('.gd-editor-handles')).not.toBeNull();
  });

  it('raises the block handles from beside the block', async () => {
    await mount(page({ markdown: 'One line.\n' }));
    await waitFor(() => expect(body().textContent).toContain('One line.'));

    // Beside the text, not on it: the pointer lands on the editable box itself.
    fireEvent.mouseMove(body());

    await waitFor(() => expect(document.querySelector('.gd-editor-handles')).not.toBeNull());
  });

  it('shows the block handles on a table', async () => {
    await mount(page({ markdown: '| Name | Count |\n| --- | --- |\n| alpha | 1 |\n' }));
    await waitFor(() => expect(body().querySelector('table')).not.toBeNull());

    fireEvent.mouseMove(body().querySelector('table') as HTMLElement);

    await waitFor(() => expect(document.querySelector('.gd-editor-handles')).not.toBeNull());
    // The table hangs its own row grips in the same gutter, so these stack clear of them.
    expect(document.querySelector('.gd-editor-handles')?.className).toContain(
      'gd-editor-handles--stacked',
    );
  });

  it('drops the block handles when the pointer goes away from the document', async () => {
    await mount(page({ markdown: 'One line.\n' }));
    await waitFor(() => expect(body().textContent).toContain('One line.'));

    fireEvent.mouseMove(body().querySelector('p') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.gd-editor-handles')).not.toBeNull());
    fireEvent.mouseMove(document.body, { clientX: 5000, clientY: 5000 });

    await waitFor(() => expect(document.querySelector('.gd-editor-handles')).toBeNull());
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
