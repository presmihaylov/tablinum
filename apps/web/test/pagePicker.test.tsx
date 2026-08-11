import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PagePicker } from '../src/editor/ui/PagePicker';
import type { WikilinkItem } from '../src/editor/extensions';
import { renderApp } from './render';

const PAGES: WikilinkItem[] = [
  { id: 'pg_deploy', path: 'eng/deploy', title: 'Deploy' },
  { id: 'pg_rollout', path: 'eng/rollout', title: 'Rollout' },
];

function search(query: string): Promise<WikilinkItem[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return Promise.resolve(PAGES);
  return Promise.resolve(PAGES.filter((item) => item.title.toLowerCase().includes(needle)));
}

interface HarnessProps {
  onPick?: (path: string) => void;
  onCreate?: (title: string) => void;
}

/** Opens and closes the picker from outside, the way the editor does. */
function Harness({ onPick = vi.fn(), onCreate = vi.fn() }: HarnessProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen((current) => !current)}>
        Toggle the picker
      </button>
      <PagePicker
        open={open}
        search={search}
        onClose={() => setOpen(false)}
        onPick={onPick}
        onCreate={onCreate}
      />
    </>
  );
}

function optionLabels(): string[] {
  return screen
    .queryAllByRole('option')
    .map((row) => row.querySelector('.menu__title')?.textContent ?? '');
}

function field(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Page' });
}

describe('PagePicker', () => {
  it('offers a new page under whatever was typed', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderApp(<Harness onCreate={onCreate} />);

    await user.type(field(), 'Rollout');
    await waitFor(() => expect(optionLabels()).toEqual(['Rollout', 'New page: Rollout']));

    await user.click(screen.getByRole('option', { name: /New page: Rollout/ }));
    expect(onCreate).toHaveBeenCalledWith('Rollout');
  });

  it('picks a page that already exists', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderApp(<Harness onPick={onPick} />);

    await user.type(field(), 'Deploy');
    await waitFor(() => expect(optionLabels()).toContain('Deploy'));

    await user.click(screen.getByRole('option', { name: /eng\/deploy/ }));
    expect(onPick).toHaveBeenCalledWith('eng/deploy');
  });

  it('starts empty again after it is closed and reopened', async () => {
    const user = userEvent.setup();
    renderApp(<Harness />);
    await user.type(field(), 'Rollout');
    await waitFor(() => expect(optionLabels()).toEqual(['Rollout', 'New page: Rollout']));

    // The reset runs on the way out. The way in must leave the field alone, or the first
    // keys of a fast typist are wiped when React flushes the effect after the paint.
    const toggle = screen.getByRole('button', { name: 'Toggle the picker' });
    await user.click(toggle);
    await user.click(toggle);

    expect(field()).toHaveValue('');
    await waitFor(() => expect(optionLabels()).toEqual(['Deploy', 'Rollout']));
  });
});
