import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS, filterSlashCommands } from '../../src/editor/extensions';

const ids = (query: string): string[] => filterSlashCommands(query).map((item) => item.id);

describe('slash menu filtering', () => {
  it('offers every block when the query is empty', () => {
    expect(filterSlashCommands('')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('offers every block for a query of only spaces', () => {
    expect(filterSlashCommands('   ')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('covers the blocks the product promises', () => {
    expect(ids('')).toEqual(
      expect.arrayContaining([
        'h1',
        'h2',
        'h3',
        'bulletList',
        'orderedList',
        'taskList',
        'codeBlock',
        'blockquote',
        'callout',
        'horizontalRule',
        'table',
        'image',
        'database-inline',
        'database-page',
        'board-view',
      ]),
    );
  });

  it('matches a keyword prefix', () => {
    expect(ids('tod')).toEqual(['taskList']);
    expect(ids('div')).toEqual(['horizontalRule']);
  });

  it('matches a substring of the title', () => {
    expect(ids('head')).toEqual(['h1', 'h2', 'h3']);
  });

  it('ignores case and surrounding spaces', () => {
    expect(ids('  TABLE ')).toEqual(ids('table'));
    expect(ids('  TABLE ')[0]).toBe('table');
  });

  it('narrows as more characters are typed', () => {
    const one = ids('c');
    const two = ids('co');
    const three = ids('cod');
    expect(one.length).toBeGreaterThan(two.length);
    expect(two.length).toBeGreaterThanOrEqual(three.length);
    expect(three).toEqual(['codeBlock']);
  });

  it('returns nothing for a query that matches no block', () => {
    expect(filterSlashCommands('zzzz')).toEqual([]);
  });

  it('never mutates the source list', () => {
    const before = SLASH_COMMANDS.length;
    filterSlashCommands('').pop();
    expect(SLASH_COMMANDS).toHaveLength(before);
  });
});
