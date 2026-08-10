import { describe, expect, it } from 'vitest';
import {
  DatabaseSchema,
  newPropertyId,
  newViewId,
  type Database,
  type DbProperty,
  type DbView,
} from '../src/databases.js';
import { databaseRev, mergeDatabases } from '../src/db-merge.js';

const STATUS = newPropertyId(1);
const NOTES = newPropertyId(2);
const OWNER = newPropertyId(3);
const DUE = newPropertyId(4);
const TABLE = newViewId(5);
const BOARD = newViewId(6);

function property(id: string, name: string, over: Partial<DbProperty> = {}): DbProperty {
  return { id, name, type: 'text', options: [], ...over };
}

function view(id: string, name: string, over: Partial<DbView> = {}): DbView {
  return { id, name, type: 'table', filters: [], sorts: [], hidden: [], ...over };
}

function base(): Database {
  return {
    properties: [property(STATUS, 'Status'), property(NOTES, 'Notes')],
    views: [view(TABLE, 'Table')],
  };
}

/** The property names of a merge, in order, so a test reads as a sentence. */
function names(database: Database): string[] {
  return database.properties.map((entry) => entry.name);
}

describe('databaseRev', () => {
  it('gives two equal schemas the same revision', () => {
    expect(databaseRev(base())).toBe(databaseRev(base()));
  });

  it('gives a changed schema a different revision', () => {
    const changed = base();
    changed.properties = [property(STATUS, 'State'), property(NOTES, 'Notes')];
    expect(databaseRev(changed)).not.toBe(databaseRev(base()));
  });

  it('ignores the order the keys of a property happen to be written in', () => {
    const reordered: Database = {
      views: [{ hidden: [], sorts: [], filters: [], type: 'table', name: 'Table', id: TABLE }],
      properties: [
        { options: [], type: 'text', name: 'Status', id: STATUS },
        { options: [], type: 'text', name: 'Notes', id: NOTES },
      ],
    };
    expect(databaseRev(reordered)).toBe(databaseRev(base()));
  });

  it('reads a schema the merge produced, so a revision survives a round trip', () => {
    const merged = mergeDatabases(base(), base(), base());
    expect(DatabaseSchema.safeParse(merged.database).success).toBe(true);
    expect(databaseRev(merged.database)).toBe(databaseRev(base()));
  });
});

describe('mergeDatabases', () => {
  it('keeps both properties when each side adds one', () => {
    const mine = base();
    mine.properties = [...mine.properties, property(OWNER, 'Owner')];
    const theirs = base();
    theirs.properties = [...theirs.properties, property(DUE, 'Due')];

    const merged = mergeDatabases(base(), mine, theirs);
    expect(merged.clean).toBe(true);
    expect(names(merged.database)).toEqual(['Status', 'Notes', 'Due', 'Owner']);
  });

  it('takes a rename from the side that made it', () => {
    const mine = base();
    mine.properties = [property(STATUS, 'State'), property(NOTES, 'Notes')];
    const theirs = base();
    theirs.properties = [...theirs.properties, property(OWNER, 'Owner')];

    const merged = mergeDatabases(base(), mine, theirs);
    expect(merged.clean).toBe(true);
    expect(names(merged.database)).toEqual(['State', 'Notes', 'Owner']);
  });

  it('keeps a delete that the other side left alone', () => {
    const mine = base();
    mine.properties = [property(STATUS, 'Status')];
    const theirs = base();
    theirs.properties = [...theirs.properties, property(OWNER, 'Owner')];

    const merged = mergeDatabases(base(), mine, theirs);
    expect(merged.clean).toBe(true);
    expect(names(merged.database)).toEqual(['Status', 'Owner']);
  });

  it('refuses a delete on one side and an edit on the other', () => {
    const mine = base();
    mine.properties = [property(STATUS, 'Status')];
    const theirs = base();
    theirs.properties = [property(STATUS, 'Status'), property(NOTES, 'Remarks')];

    const merged = mergeDatabases(base(), mine, theirs);
    expect(merged.clean).toBe(false);
    expect(merged.database).toEqual(theirs);
  });

  it('refuses the same property renamed differently on both sides', () => {
    const mine = base();
    mine.properties = [property(STATUS, 'State'), property(NOTES, 'Notes')];
    const theirs = base();
    theirs.properties = [property(STATUS, 'Stage'), property(NOTES, 'Notes')];

    expect(mergeDatabases(base(), mine, theirs).clean).toBe(false);
  });

  it('accepts the same rename made on both sides', () => {
    const mine = base();
    mine.properties = [property(STATUS, 'State'), property(NOTES, 'Notes')];

    const merged = mergeDatabases(base(), mine, structuredClone(mine));
    expect(merged.clean).toBe(true);
    expect(names(merged.database)).toEqual(['State', 'Notes']);
  });

  it('follows the side that moved the columns', () => {
    const mine = base();
    mine.properties = [property(NOTES, 'Notes'), property(STATUS, 'Status')];
    const theirs = base();
    theirs.properties = [...theirs.properties, property(OWNER, 'Owner')];

    const merged = mergeDatabases(base(), mine, theirs);
    expect(names(merged.database)).toEqual(['Notes', 'Status', 'Owner']);
  });

  it('leaves the order to the server when both sides moved the columns', () => {
    const mine = base();
    mine.properties = [property(NOTES, 'Notes'), property(STATUS, 'Status')];
    const theirs = base();
    theirs.properties = [property(NOTES, 'Notes'), property(STATUS, 'Status')];
    theirs.views = [view(TABLE, 'Grid')];

    const merged = mergeDatabases(base(), mine, theirs);
    expect(names(merged.database)).toEqual(['Notes', 'Status']);
    expect(merged.database.views[0]?.name).toBe('Grid');
  });

  it('keeps both views when each side adds one', () => {
    const mine = base();
    mine.views = [...mine.views, view(BOARD, 'Board', { type: 'board' })];
    const theirs = base();
    theirs.views = [view(TABLE, 'Grid')];

    const merged = mergeDatabases(base(), mine, theirs);
    expect(merged.clean).toBe(true);
    expect(merged.database.views.map((entry) => entry.name)).toEqual(['Grid', 'Board']);
  });

  it('drops a filter that points at a property nobody kept', () => {
    const start = base();
    start.views = [
      view(TABLE, 'Table', {
        filters: [{ property: NOTES, op: 'is_not_empty', value: null }],
        sorts: [{ property: NOTES, direction: 'asc' }],
        hidden: [NOTES],
        groupBy: NOTES,
      }),
    ];
    const mine = structuredClone(start);
    mine.properties = [property(STATUS, 'Status')];
    const theirs = structuredClone(start);
    theirs.properties = [...theirs.properties, property(OWNER, 'Owner')];

    const merged = mergeDatabases(start, mine, theirs);
    expect(merged.clean).toBe(true);
    const only = merged.database.views[0];
    expect(only?.filters).toEqual([]);
    expect(only?.sorts).toEqual([]);
    expect(only?.hidden).toEqual([]);
    expect(only?.groupBy).toBeUndefined();
    expect(DatabaseSchema.safeParse(merged.database).success).toBe(true);
  });

  it('refuses to leave a database with no view at all', () => {
    const mine = base();
    mine.views = [];
    const theirs = base();

    expect(mergeDatabases(base(), mine, theirs).clean).toBe(false);
  });

  it('changes nothing when neither side touched the schema', () => {
    const merged = mergeDatabases(base(), base(), base());
    expect(merged.clean).toBe(true);
    expect(merged.database).toEqual(base());
  });
});
