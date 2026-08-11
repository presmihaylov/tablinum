import { describe, expect, it } from 'vitest';
import { PAGE_MENU_ROWS, pageMenuRows } from '../../src/editor/pageSearch';
import type { WikilinkItem } from '../../src/editor/extensions';

const KNOWN: WikilinkItem[] = [
  { id: 'pg_run', path: 'eng/deploy-runbook', title: 'Deploy runbook', icon: '🐙' },
  { id: 'pg_roll', path: 'eng/rollback', title: 'Rollback' },
  { id: 'pg_on', path: 'people/onboarding', title: 'Onboarding' },
];

function titles(hits: readonly WikilinkItem[], query: string): string[] {
  return pageMenuRows(hits, KNOWN, query).map((page) => page.title);
}

describe('pageMenuRows', () => {
  it('keeps the order the index answered in', () => {
    const hits: WikilinkItem[] = [
      { id: 'pg_roll', path: 'eng/rollback', title: 'Rollback' },
      { id: 'pg_run', path: 'eng/deploy-runbook', title: 'Deploy runbook' },
    ];

    expect(titles(hits, 'eng')).toEqual(['Rollback', 'Deploy runbook']);
  });

  it('adds a cached page the index missed', () => {
    expect(titles([], 'runbook')).toEqual(['Deploy runbook']);
    expect(titles([], 'depl')).toEqual(['Deploy runbook']);
  });

  it('forgives one typo in the name, which the index cannot', () => {
    expect(titles([], 'rollbak')).toEqual(['Rollback']);
    expect(titles([], 'onbaording')).toEqual(['Onboarding']);
  });

  it('rejects a word that names no page', () => {
    expect(titles([], 'capybara')).toEqual([]);
    expect(titles([], 'zebracoffee')).toEqual([]);
  });

  it('rejects a short word one letter away, which is a different word', () => {
    const cars: WikilinkItem[] = [{ id: 'pg_car', path: 'a/car', title: 'Car' }];
    expect(pageMenuRows([], cars, 'cat')).toEqual([]);
  });

  it('rejects letters found scattered through a name, and puts the shorter path first', () => {
    // "eng" reads inside "people/onboarding" letter by letter. That names nothing.
    expect(titles([], 'eng')).toEqual(['Rollback', 'Deploy runbook']);
  });

  it('lists one row per page id, so a renamed page never doubles', () => {
    // The index still holds the path the page had before the rename.
    const stale: WikilinkItem[] = [
      { id: 'pg_roll', path: 'eng/old-rollback', title: 'Rollback' },
    ];
    const rows = pageMenuRows(stale, KNOWN, 'rollback');

    expect(rows.length).toBe(1);
    expect(rows[0]?.path).toBe('eng/old-rollback');
  });

  it('lists nothing for an empty query, even with the whole tree at hand', () => {
    expect(titles([], '')).toEqual([]);
    expect(titles([], '   ')).toEqual([]);
  });

  it('never draws more rows than the menu holds', () => {
    const many: WikilinkItem[] = Array.from({ length: 20 }, (_, index) => ({
      id: `pg_${index}`,
      path: `eng/note-${index}`,
      title: `Note ${index}`,
    }));

    expect(pageMenuRows([], many, 'note').length).toBe(PAGE_MENU_ROWS);
  });

  it('keeps the icon each source carries', () => {
    const rows = pageMenuRows([], KNOWN, 'runbook');
    expect(rows[0]?.icon).toBe('🐙');
  });
});
