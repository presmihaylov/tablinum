import { describe, expect, it } from 'vitest';
import {
  CommentThreadSchema,
  CommentsQuerySchema,
  CreateThreadBodySchema,
  threadTarget,
  threadsForColumn,
  unresolvedCount,
  type CommentThread,
} from '../src/comments.js';
import { newPropertyId } from '../src/databases.js';
import { newPageId } from '../src/ids.js';

const PAGE = newPageId();
const STATUS = newPropertyId();
const NOTES = newPropertyId();

const ANCHOR = { quote: 'the deploy runbook', prefix: 'The ', suffix: ' body.', start: 4 };

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  const id = overrides.id ?? 'ct_01J8XYZABCDEFGHJKMNPQRSTVW';
  return {
    id,
    pageId: PAGE,
    anchor: null,
    column: null,
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    created: '2026-08-08T10:00:00.000Z',
    updated: '2026-08-08T10:00:00.000Z',
    comments: [
      {
        id: 'cm_01J8XYZABCDEFGHJKMNPQRSTVW',
        threadId: id,
        author: 'us_01J8XYZABCDEFGHJKMNPQRSTVW',
        body: 'Should this column be a select?',
        created: '2026-08-08T10:00:00.000Z',
        updated: '2026-08-08T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('CommentThreadSchema', () => {
  it('accepts a thread about a database column', () => {
    const parsed = CommentThreadSchema.parse(thread({ column: STATUS }));
    expect(parsed.column).toBe(STATUS);
    expect(parsed.anchor).toBeNull();
  });

  it('accepts a thread about the whole page', () => {
    expect(CommentThreadSchema.parse(thread()).column).toBeNull();
  });

  it('refuses a column that is not a property id', () => {
    expect(() => CommentThreadSchema.parse(thread({ column: 'Status' }))).toThrow();
  });

  it('wants the column, so a thread can never leave the answer out', () => {
    const { column: _column, ...rest } = thread();
    expect(() => CommentThreadSchema.parse(rest)).toThrow();
  });
});

describe('CreateThreadBodySchema', () => {
  it('takes a column on its own', () => {
    const parsed = CreateThreadBodySchema.parse({ body: 'Rename this', column: STATUS });
    expect(parsed.column).toBe(STATUS);
  });

  it('takes an anchor on its own', () => {
    const parsed = CreateThreadBodySchema.parse({ body: 'Reword this', anchor: ANCHOR });
    expect(parsed.anchor).toEqual(ANCHOR);
  });

  it('takes neither, which means the whole page', () => {
    const parsed = CreateThreadBodySchema.parse({ body: 'Nice page' });
    expect(parsed.anchor).toBeUndefined();
    expect(parsed.column).toBeUndefined();
  });

  it('refuses an anchor and a column together', () => {
    expect(() =>
      CreateThreadBodySchema.parse({ body: 'Both', anchor: ANCHOR, column: STATUS }),
    ).toThrow();
  });

  it('refuses a column name in place of a column id', () => {
    expect(() => CreateThreadBodySchema.parse({ body: 'Rename this', column: 'Status' })).toThrow();
  });
});

describe('CommentsQuerySchema', () => {
  it('narrows to one column', () => {
    expect(CommentsQuerySchema.parse({ column: NOTES }).column).toBe(NOTES);
  });

  it('narrows to one column and one state together', () => {
    const parsed = CommentsQuerySchema.parse({ column: NOTES, resolved: 'false' });
    expect(parsed).toEqual({ column: NOTES, resolved: 'false' });
  });

  it('refuses a column that is not a property id', () => {
    expect(() => CommentsQuerySchema.parse({ column: 'Notes' })).toThrow();
  });
});

describe('threadsForColumn', () => {
  const onStatus = thread({ id: 'ct_01J8XYZABCDEFGHJKMNPQRSTV1', column: STATUS });
  const onNotes = thread({ id: 'ct_01J8XYZABCDEFGHJKMNPQRSTV2', column: NOTES });
  const onPage = thread({ id: 'ct_01J8XYZABCDEFGHJKMNPQRSTV3' });
  const onText = thread({ id: 'ct_01J8XYZABCDEFGHJKMNPQRSTV4', anchor: ANCHOR });
  const all = [onStatus, onNotes, onPage, onText];

  it('keeps only the threads about that column', () => {
    expect(threadsForColumn(all, STATUS)).toEqual([onStatus]);
  });

  it('keeps the order it was given', () => {
    const second = thread({ id: 'ct_01J8XYZABCDEFGHJKMNPQRSTV5', column: STATUS });
    expect(threadsForColumn([onStatus, onNotes, second], STATUS)).toEqual([onStatus, second]);
  });

  it('never matches a thread about the page or about text', () => {
    expect(threadsForColumn(all, 'pr_01J8XYZABCDEFGHJKMNPQRSTVW')).toEqual([]);
  });

  it('counts the open ones the same way as any other thread', () => {
    const resolved = thread({ id: 'ct_01J8XYZABCDEFGHJKMNPQRSTV6', column: STATUS, resolved: true });
    expect(unresolvedCount(threadsForColumn([onStatus, resolved], STATUS))).toBe(1);
  });
});

describe('threadTarget', () => {
  it('calls a thread with a column a column thread', () => {
    expect(threadTarget(thread({ column: STATUS }))).toEqual({ kind: 'column', column: STATUS });
  });

  it('calls a thread with an anchor a quote thread, and hands back the anchor', () => {
    expect(threadTarget(thread({ anchor: ANCHOR }))).toEqual({ kind: 'quote', anchor: ANCHOR });
  });

  it('calls a thread with neither a page thread', () => {
    expect(threadTarget(thread())).toEqual({ kind: 'page' });
  });

  it('reads a draft, which carries the same two fields', () => {
    expect(threadTarget({ anchor: null, column: NOTES })).toEqual({
      kind: 'column',
      column: NOTES,
    });
  });
});
