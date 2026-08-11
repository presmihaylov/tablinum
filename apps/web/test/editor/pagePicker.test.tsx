import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { PagePicker } from '../../src/editor/ui/PagePicker';
import type { WikilinkItem } from '../../src/editor/extensions';
import { renderApp } from '../render';

afterEach(cleanup);

const PAGES: WikilinkItem[] = [
  { id: 'pg_deploy', path: 'eng/deploy', title: 'Deploy' },
  { id: 'pg_rollback', path: 'eng/rollback', title: 'Rollback' },
];

function search(query: string): Promise<WikilinkItem[]> {
  if (query.trim().length === 0) return Promise.resolve([]);
  return Promise.resolve(PAGES.filter((item) => item.title.toLowerCase().includes(query)));
}

function mount(onPick = vi.fn(), onClose = vi.fn(), onCreate = vi.fn()) {
  renderApp(
    <PagePicker open search={search} onClose={onClose} onPick={onPick} onCreate={onCreate} />,
  );
  return { onPick, onClose, onCreate };
}

function field(): HTMLElement {
  return screen.getByPlaceholderText('Search pages…');
}

/** The titles of the page rows, without the offer to create one. */
function pageTitles(): string[] {
  return screen
    .queryAllByRole('option')
    .map((row) => row.querySelector('.menu__title')?.textContent ?? '')
    .filter((title) => !title.startsWith('New page: '));
}

describe('PagePicker', () => {
  it('asks for a query before it lists anything', async () => {
    mount();

    expect(await screen.findByText('Type to find a page, or to name a new one.')).toBeTruthy();
  });

  it('lists what the search finds', async () => {
    mount();

    fireEvent.change(field(), { target: { value: 'o' } });

    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(3));
    expect(screen.getByText('eng/rollback')).toBeTruthy();
  });

  it('offers a new page when nothing matches', async () => {
    mount();

    fireEvent.change(field(), { target: { value: 'zzz' } });

    const only = await screen.findAllByRole('option');
    expect(only.length).toBe(1);
    expect(only[0]).toHaveTextContent('New page: zzz');
  });

  it('hands back the page that is clicked, and closes', async () => {
    const { onPick, onClose } = mount();

    fireEvent.change(field(), { target: { value: 'deploy' } });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(2));
    fireEvent.click(screen.getAllByRole('option')[0] as HTMLElement);

    expect(onPick).toHaveBeenCalledWith('eng/deploy');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('walks the list with the arrow keys and picks on Enter', async () => {
    const { onPick } = mount();

    fireEvent.change(field(), { target: { value: 'o' } });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(3));
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith('eng/rollback');
  });

  it('keeps the new-page row last, so an existing page stays the default', async () => {
    const { onPick, onCreate } = mount();

    fireEvent.change(field(), { target: { value: 'deploy' } });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(2));
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith('eng/deploy');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates a page with the typed title, and closes', async () => {
    const { onCreate, onClose, onPick } = mount();

    fireEvent.change(field(), { target: { value: '  Release notes  ' } });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(1));
    fireEvent.click(screen.getAllByRole('option')[0] as HTMLElement);

    expect(onCreate).toHaveBeenCalledWith('Release notes');
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reaches the new-page row with the arrow keys', async () => {
    const { onCreate } = mount();

    fireEvent.change(field(), { target: { value: 'o' } });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(3));
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onCreate).toHaveBeenCalledWith('o');
  });
});

const ICONED: WikilinkItem[] = [
  { id: 'pg_deploy', path: 'eng/deploy', title: 'Deploy', icon: '🚀' },
  { id: 'pg_rollback', path: 'eng/rollback', title: 'Rollback', icon: ':party:' },
  { id: 'pg_notes', path: 'eng/notes', title: 'Notes' },
];

function mountIconed() {
  renderApp(
    <PagePicker
      open
      search={() => Promise.resolve(ICONED)}
      onClose={vi.fn()}
      onPick={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
}

function rowFor(title: string): HTMLElement {
  const row = screen
    .getAllByRole('option')
    .find((option) => option.querySelector('.menu__title')?.textContent === title);
  if (!row) throw new Error(`No row for ${title}`);
  return row;
}

describe('PagePicker icons', () => {
  it('draws the emoji of a page, a custom one as a picture, and a blank page for neither', async () => {
    mountIconed();

    fireEvent.change(field(), { target: { value: 'eng' } });
    await waitFor(() => expect(pageTitles().length).toBe(3));

    expect(rowFor('Deploy').querySelector('.menu__page-icon')?.textContent).toBe('🚀');
    expect(rowFor('Rollback').querySelector('img')?.getAttribute('alt')).toBe(':party:');
    expect(rowFor('Notes').querySelector('.menu__page-icon svg')).toBeTruthy();
  });
});
