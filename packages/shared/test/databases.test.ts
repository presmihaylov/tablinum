import { describe, expect, it } from 'vitest';
import {
  DatabaseSchema,
  OPS_FOR_TYPE,
  applyView,
  coerceProps,
  coerceValue,
  compareValues,
  dateEnd,
  dateStart,
  isEmptyValue,
  isOptionId,
  isPropertyId,
  isViewId,
  newOptionId,
  newPropertyId,
  newViewId,
  opTakesNoValue,
  starterDatabase,
  type Database,
  type DbProperty,
  type DbRow,
  type DbView,
  type SelectOption,
} from '../src/index.js';

const TODO: SelectOption = { id: newOptionId(), name: 'Todo', color: 'gray' };
const DOING: SelectOption = { id: newOptionId(), name: 'Doing', color: 'blue' };
const DONE: SelectOption = { id: newOptionId(), name: 'Done', color: 'green' };

const status: DbProperty = {
  id: newPropertyId(),
  name: 'Status',
  type: 'select',
  options: [TODO, DOING, DONE],
};
const score: DbProperty = { id: newPropertyId(), name: 'Score', type: 'number', options: [] };
const notes: DbProperty = { id: newPropertyId(), name: 'Notes', type: 'text', options: [] };
const due: DbProperty = { id: newPropertyId(), name: 'Due', type: 'date', options: [] };
const done: DbProperty = { id: newPropertyId(), name: 'Done', type: 'checkbox', options: [] };
const tags: DbProperty = {
  id: newPropertyId(),
  name: 'Tags',
  type: 'multi_select',
  options: [TODO, DOING],
};

const view: DbView = {
  id: newViewId(),
  name: 'Table',
  type: 'table',
  filters: [],
  sorts: [],
  hidden: [],
};

const database: Database = {
  properties: [status, score, notes, due, done, tags],
  views: [view],
};

function row(id: string, props: DbRow['props']): DbRow {
  return {
    id,
    path: `docs/tasks/${id}`,
    title: id,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    props,
  };
}

describe('ids', () => {
  it('mints ids each kind recognises and the others reject', () => {
    const property = newPropertyId();
    const option = newOptionId();
    const viewId = newViewId();
    expect(isPropertyId(property)).toBe(true);
    expect(isOptionId(option)).toBe(true);
    expect(isViewId(viewId)).toBe(true);
    expect(isPropertyId(option)).toBe(false);
    expect(isViewId(property)).toBe(false);
    expect(isOptionId('op_nope')).toBe(false);
  });
});

describe('starterDatabase', () => {
  it('passes its own schema and carries exactly one view', () => {
    const starter = starterDatabase();
    expect(() => DatabaseSchema.parse(starter)).not.toThrow();
    expect(starter.views).toHaveLength(1);
    expect(starter.views[0]?.type).toBe('table');
  });

  it('refuses a database with no view at all', () => {
    expect(() => DatabaseSchema.parse({ properties: [], views: [] })).toThrow();
  });
});

describe('coerceValue', () => {
  it('keeps a value the property can hold', () => {
    expect(coerceValue(notes, 'hello')).toBe('hello');
    expect(coerceValue(score, 42)).toBe(42);
    expect(coerceValue(done, true)).toBe(true);
    expect(coerceValue(due, '2026-03-04')).toBe('2026-03-04');
    expect(coerceValue(due, '2026-03-04/2026-03-06')).toBe('2026-03-04/2026-03-06');
    expect(coerceValue(status, DOING.id)).toBe(DOING.id);
    expect(coerceValue(tags, [TODO.id, DOING.id])).toEqual([TODO.id, DOING.id]);
  });

  it('reads a number written as text and refuses one that is not a number', () => {
    expect(coerceValue(score, '7.5')).toBe(7.5);
    expect(coerceValue(score, 'seven')).toBeNull();
    expect(coerceValue(score, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('drops a select value no option matches', () => {
    expect(coerceValue(status, 'op_00000000000000000000000000')).toBeNull();
    expect(coerceValue(tags, [TODO.id, 'op_00000000000000000000000000'])).toEqual([TODO.id]);
    expect(coerceValue(tags, ['op_00000000000000000000000000'])).toBeNull();
  });

  it('refuses a date that is not YYYY-MM-DD', () => {
    expect(coerceValue(due, '4 March')).toBeNull();
    expect(coerceValue(due, '2026-3-4')).toBeNull();
  });

  it('turns an empty value into null so nothing empty is ever written', () => {
    expect(coerceValue(notes, '')).toBeNull();
    expect(coerceValue(notes, undefined)).toBeNull();
    expect(coerceValue(tags, [])).toBeNull();
  });
});

describe('coerceProps', () => {
  it('keeps only what the current schema still describes', () => {
    const props = coerceProps(database.properties, {
      [notes.id]: 'kept',
      [score.id]: 3,
      pr_00000000000000000000000000: 'dropped',
      nonsense: true,
    });
    expect(props).toEqual({ [notes.id]: 'kept', [score.id]: 3 });
  });

  it('returns an empty record for anything that is not an object', () => {
    expect(coerceProps(database.properties, null)).toEqual({});
    expect(coerceProps(database.properties, ['a'])).toEqual({});
    expect(coerceProps(database.properties, 'text')).toEqual({});
  });
});

describe('isEmptyValue', () => {
  it('treats null, empty text, an empty list and an unchecked box as empty', () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(false)).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue('x')).toBe(false);
  });
});

describe('dateStart and dateEnd', () => {
  it('reads both ends of a range and both ends of a single day', () => {
    expect(dateStart('2026-03-04/2026-03-06')).toBe('2026-03-04');
    expect(dateEnd('2026-03-04/2026-03-06')).toBe('2026-03-06');
    expect(dateStart('2026-03-04')).toBe('2026-03-04');
    expect(dateEnd('2026-03-04')).toBe('2026-03-04');
  });
});

describe('OPS_FOR_TYPE', () => {
  it('offers every type at least one operator, and a checkbox only "is"', () => {
    for (const ops of Object.values(OPS_FOR_TYPE)) expect(ops.length).toBeGreaterThan(0);
    expect(OPS_FOR_TYPE.checkbox).toEqual(['is']);
  });

  it('knows which operators read no value', () => {
    expect(opTakesNoValue('is_empty')).toBe(true);
    expect(opTakesNoValue('is_not_empty')).toBe(true);
    expect(opTakesNoValue('contains')).toBe(false);
  });
});

describe('applyView filters', () => {
  const rows = [
    row('a', { [status.id]: TODO.id, [score.id]: 1, [notes.id]: 'alpha' }),
    row('b', { [status.id]: DONE.id, [score.id]: 9, [notes.id]: 'beta' }),
    row('c', {}),
  ];

  const withFilters = (filters: DbView['filters']): string[] =>
    applyView(database, { ...view, filters }, rows).map((entry) => entry.id);

  it('keeps every row when the view has no filter', () => {
    expect(withFilters([])).toEqual(['a', 'b', 'c']);
  });

  it('matches a select by option id', () => {
    expect(withFilters([{ property: status.id, op: 'is', value: DONE.id }])).toEqual(['b']);
    expect(withFilters([{ property: status.id, op: 'is_not', value: DONE.id }])).toEqual(['a', 'c']);
  });

  it('compares numbers', () => {
    expect(withFilters([{ property: score.id, op: 'gt', value: 5 }])).toEqual(['b']);
    expect(withFilters([{ property: score.id, op: 'lt', value: 5 }])).toEqual(['a']);
  });

  it('searches text without regard to case', () => {
    expect(withFilters([{ property: notes.id, op: 'contains', value: 'ALP' }])).toEqual(['a']);
    expect(withFilters([{ property: notes.id, op: 'does_not_contain', value: 'alp' }])).toEqual([
      'b',
      'c',
    ]);
  });

  it('finds empty and non-empty cells', () => {
    expect(withFilters([{ property: notes.id, op: 'is_empty', value: null }])).toEqual(['c']);
    expect(withFilters([{ property: notes.id, op: 'is_not_empty', value: null }])).toEqual([
      'a',
      'b',
    ]);
  });

  it('joins two filters with AND', () => {
    expect(
      withFilters([
        { property: score.id, op: 'gt', value: 0 },
        { property: notes.id, op: 'contains', value: 'beta' },
      ]),
    ).toEqual(['b']);
  });

  it('ignores a filter that names a property the schema no longer has', () => {
    expect(
      withFilters([{ property: 'pr_00000000000000000000000000', op: 'is', value: 'x' }]),
    ).toEqual(['a', 'b', 'c']);
  });

  it('compares dates by day', () => {
    const dated = [
      row('early', { [due.id]: '2026-01-01' }),
      row('late', { [due.id]: '2026-12-31' }),
    ];
    const ids = (filters: DbView['filters']): string[] =>
      applyView(database, { ...view, filters }, dated).map((entry) => entry.id);
    expect(ids([{ property: due.id, op: 'before', value: '2026-06-01' }])).toEqual(['early']);
    expect(ids([{ property: due.id, op: 'after', value: '2026-06-01' }])).toEqual(['late']);
    expect(ids([{ property: due.id, op: 'is', value: '2026-01-01' }])).toEqual(['early']);
  });

  it('matches a checkbox against true and against false', () => {
    const boxes = [row('on', { [done.id]: true }), row('off', {})];
    const ids = (value: boolean): string[] =>
      applyView(database, { ...view, filters: [{ property: done.id, op: 'is', value }] }, boxes).map(
        (entry) => entry.id,
      );
    expect(ids(true)).toEqual(['on']);
    expect(ids(false)).toEqual(['off']);
  });

  it('matches a multi-select by one of its options', () => {
    const tagged = [row('one', { [tags.id]: [TODO.id] }), row('two', { [tags.id]: [DOING.id] })];
    const ids = (op: 'contains' | 'does_not_contain'): string[] =>
      applyView(
        database,
        { ...view, filters: [{ property: tags.id, op, value: TODO.id }] },
        tagged,
      ).map((entry) => entry.id);
    expect(ids('contains')).toEqual(['one']);
    expect(ids('does_not_contain')).toEqual(['two']);
  });
});

describe('applyView sorts', () => {
  it('sorts a number ascending and descending', () => {
    const rows = [row('a', { [score.id]: 2 }), row('b', { [score.id]: 1 })];
    const ids = (direction: 'asc' | 'desc'): string[] =>
      applyView(database, { ...view, sorts: [{ property: score.id, direction }] }, rows).map(
        (entry) => entry.id,
      );
    expect(ids('asc')).toEqual(['b', 'a']);
    expect(ids('desc')).toEqual(['a', 'b']);
  });

  it('puts an empty cell last whichever way it sorts', () => {
    const rows = [row('empty', {}), row('filled', { [score.id]: 5 })];
    const ids = (direction: 'asc' | 'desc'): string[] =>
      applyView(database, { ...view, sorts: [{ property: score.id, direction }] }, rows).map(
        (entry) => entry.id,
      );
    expect(ids('asc')[1]).toBe('empty');
    expect(ids('desc')[1]).toBe('empty');
  });

  it('sorts a select by the order of its options, not by name', () => {
    const rows = [row('z', { [status.id]: DONE.id }), row('a', { [status.id]: TODO.id })];
    const sorted = applyView(
      database,
      { ...view, sorts: [{ property: status.id, direction: 'asc' }] },
      rows,
    );
    expect(sorted.map((entry) => entry.id)).toEqual(['a', 'z']);
  });

  it('breaks a tie on the row id, so the order never wobbles', () => {
    const rows = [row('b', { [score.id]: 1 }), row('a', { [score.id]: 1 })];
    const sorted = applyView(
      database,
      { ...view, sorts: [{ property: score.id, direction: 'asc' }] },
      rows,
    );
    expect(sorted.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('falls through to the second sort when the first ties', () => {
    const rows = [
      row('a', { [score.id]: 1, [notes.id]: 'zulu' }),
      row('b', { [score.id]: 1, [notes.id]: 'alpha' }),
    ];
    const sorted = applyView(
      database,
      {
        ...view,
        sorts: [
          { property: score.id, direction: 'asc' },
          { property: notes.id, direction: 'asc' },
        ],
      },
      rows,
    );
    expect(sorted.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});

describe('compareValues', () => {
  it('sorts text naturally, so "item 10" follows "item 9"', () => {
    expect(compareValues(notes, 'item 9', 'item 10')).toBeLessThan(0);
  });

  it('sorts an unchecked box before a checked one', () => {
    expect(compareValues(done, false, true)).toBeLessThan(0);
  });
});
