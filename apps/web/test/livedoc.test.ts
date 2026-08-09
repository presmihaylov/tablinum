import { describe, expect, it, vi } from 'vitest';
import { hasConflictMarkers } from '@gitdocs/shared';
import { LiveDoc, type DocConflict } from '../src/lib/livedoc';

interface Harness {
  doc: LiveDoc;
  adopted: Array<{ markdown: string; title: string }>;
  conflicts: Array<DocConflict | null>;
}

function makeDoc(markdown: string, title = 'Guide'): Harness {
  const adopted: Array<{ markdown: string; title: string }> = [];
  const conflicts: Array<DocConflict | null> = [];
  const doc = new LiveDoc({
    markdown,
    rev: 'rev-0',
    title,
    onAdopt: (text, name) => adopted.push({ markdown: text, title: name }),
    onConflict: (conflict) => conflicts.push(conflict),
  });
  return { doc, adopted, conflicts };
}

const BASE = 'one\ntwo\nthree\n';

describe('LiveDoc', () => {
  it('starts clean and turns dirty on the first edit', () => {
    const { doc } = makeDoc(BASE);
    expect(doc.dirty).toBe(false);
    doc.edit('changed');
    expect(doc.dirty).toBe(true);
  });

  it('is clean again once the save is accepted', () => {
    const { doc } = makeDoc(BASE);
    doc.edit('changed');
    doc.accept('changed', 'rev-1');
    expect(doc.dirty).toBe(false);
    expect(doc.rev).toBe('rev-1');
  });

  it('says nothing changed when the remote copy is what is on screen', () => {
    const { doc, adopted } = makeDoc(BASE);
    doc.edit('changed');
    const outcome = doc.reconcile({ markdown: 'changed', rev: 'rev-9' }, 'peer');
    expect(outcome).toEqual({ kind: 'same' });
    expect(doc.rev).toBe('rev-9');
    expect(doc.dirty).toBe(false);
    expect(adopted).toEqual([]);
  });

  it('takes the remote copy when this tab has no unsaved edit', () => {
    const { doc, adopted } = makeDoc(BASE);
    const outcome = doc.reconcile({ markdown: 'theirs\n', rev: 'rev-9' }, 'git');
    expect(outcome).toEqual({ kind: 'taken' });
    expect(doc.local).toBe('theirs\n');
    expect(doc.rev).toBe('rev-9');
    expect(adopted).toEqual([{ markdown: 'theirs\n', title: 'Guide' }]);
  });

  it('merges two edits that touch different lines', () => {
    const { doc, adopted, conflicts } = makeDoc(BASE);
    doc.edit('ONE\ntwo\nthree\n');
    const outcome = doc.reconcile({ markdown: 'one\ntwo\nTHREE\n', rev: 'rev-9' }, 'peer');

    expect(outcome).toEqual({ kind: 'merged', text: 'ONE\ntwo\nTHREE\n' });
    expect(doc.local).toBe('ONE\ntwo\nTHREE\n');
    expect(doc.rev).toBe('rev-9');
    // The merge is on screen but not yet on the server, so it still has to be saved.
    expect(doc.dirty).toBe(true);
    expect(adopted).toEqual([{ markdown: 'ONE\ntwo\nTHREE\n', title: 'Guide' }]);
    expect(conflicts).toEqual([]);
  });

  it('raises a conflict when the two edits touch the same line', () => {
    const { doc, adopted, conflicts } = makeDoc(BASE);
    doc.edit('mine\ntwo\nthree\n');
    const outcome = doc.reconcile({ markdown: 'theirs\ntwo\nthree\n', rev: 'rev-9' }, 'git');

    expect(outcome).toEqual({ kind: 'blocked' });
    expect(adopted).toEqual([]);
    expect(conflicts).toHaveLength(1);

    const conflict = conflicts[0];
    expect(conflict?.source).toBe('git');
    expect(conflict?.base).toBe(BASE);
    expect(conflict?.local).toBe('mine\ntwo\nthree\n');
    expect(conflict?.remote).toBe('theirs\ntwo\nthree\n');
    expect(conflict?.rev).toBe('rev-9');
    expect(hasConflictMarkers(conflict?.merged ?? '')).toBe(true);
  });

  it('freezes while a conflict is open, so the two sides cannot move', () => {
    const { doc } = makeDoc(BASE);
    doc.edit('mine\ntwo\nthree\n');
    doc.reconcile({ markdown: 'theirs\ntwo\nthree\n', rev: 'rev-9' }, 'peer');

    const again = doc.reconcile({ markdown: 'a third copy\n', rev: 'rev-10' }, 'peer');
    expect(again).toEqual({ kind: 'blocked' });
    expect(doc.rev).toBe('rev-0');
    expect(doc.conflict?.remote).toBe('theirs\ntwo\nthree\n');
  });

  it('saves the resolution against the revision that caused the conflict', () => {
    const { doc, adopted, conflicts } = makeDoc(BASE);
    doc.edit('mine\ntwo\nthree\n');
    doc.reconcile({ markdown: 'theirs\ntwo\nthree\n', rev: 'rev-9' }, 'peer');

    expect(doc.resolve('agreed\ntwo\nthree\n')).toBe('agreed\ntwo\nthree\n');
    expect(doc.conflict).toBeNull();
    expect(doc.rev).toBe('rev-9');
    expect(doc.local).toBe('agreed\ntwo\nthree\n');
    expect(doc.dirty).toBe(true);
    expect(conflicts[1]).toBeNull();
    expect(adopted).toEqual([{ markdown: 'agreed\ntwo\nthree\n', title: 'Guide' }]);
  });

  it('ignores a resolution when nothing is in conflict', () => {
    const { doc } = makeDoc(BASE);
    expect(doc.resolve('anything')).toBeNull();
  });

  it('reconciles again once the conflict is resolved', () => {
    const { doc } = makeDoc(BASE);
    doc.edit('mine\ntwo\nthree\n');
    doc.reconcile({ markdown: 'theirs\ntwo\nthree\n', rev: 'rev-9' }, 'peer');
    doc.resolve('agreed\ntwo\nthree\n');

    const outcome = doc.reconcile({ markdown: 'agreed\ntwo\nthree\n', rev: 'rev-11' }, 'peer');
    expect(outcome).toEqual({ kind: 'same' });
    expect(doc.rev).toBe('rev-11');
  });

  it('follows the remote title while the local one is untouched', () => {
    const { doc } = makeDoc(BASE);
    doc.reconcile({ markdown: 'theirs\n', rev: 'rev-9', title: 'Renamed' }, 'peer');
    expect(doc.title).toBe('Renamed');
  });

  it('keeps a title the user is editing', () => {
    const { doc } = makeDoc(BASE);
    doc.editTitle('My own title');
    doc.reconcile({ markdown: 'theirs\n', rev: 'rev-9', title: 'Renamed' }, 'peer');
    expect(doc.title).toBe('My own title');
  });

  it('follows the remote title again after the local title is saved', () => {
    const { doc } = makeDoc(BASE);
    doc.editTitle('My own title');
    doc.acceptTitle('My own title');
    doc.reconcile({ markdown: 'theirs\n', rev: 'rev-9', title: 'Renamed' }, 'peer');
    expect(doc.title).toBe('Renamed');
  });

  it('leaves the title alone when the copy carries none', () => {
    const { doc } = makeDoc(BASE);
    doc.reconcile({ markdown: 'theirs\n', rev: 'rev-9' }, 'peer');
    expect(doc.title).toBe('Guide');
  });

  it('does not call back on a save it already knows about', () => {
    const onAdopt = vi.fn();
    const doc = new LiveDoc({
      markdown: BASE,
      rev: 'rev-0',
      title: 'Guide',
      onAdopt,
      onConflict: () => undefined,
    });
    doc.edit('mine\n');
    doc.accept('mine\n', 'rev-1');
    doc.reconcile({ markdown: 'mine\n', rev: 'rev-1' }, 'peer');
    expect(onAdopt).not.toHaveBeenCalled();
  });
});
