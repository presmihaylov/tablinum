import { afterEach, describe, expect, it } from 'vitest';
import { MAX_COMMENT_LENGTH, isAppError, type CommentAnchor } from '@tablinum/shared';
import { AccountStore } from '../src/store.js';

const open: AccountStore[] = [];

function store(): AccountStore {
  const created = new AccountStore({ dbPath: ':memory:' });
  created.init();
  open.push(created);
  return created;
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

const PAGE = 'pg_01J8XYZABCDEFGHJKMNPQRSTV';
const OTHER_PAGE = 'pg_01J8XYZABCDEFGHJKMNPQRSTW';
const ADA = 'us_ada';
const GRACE = 'us_grace';

const ANCHOR: CommentAnchor = { quote: 'ships on Friday', prefix: 'The build ', suffix: '.', start: 10 };

/** The error code an AppError carries, so a test can assert the wire behaviour. */
function codeOf(work: () => unknown): string {
  try {
    work();
  } catch (err) {
    return isAppError(err) ? err.code : `unexpected: ${String(err)}`;
  }
  return 'no error';
}

function workspace(accounts: AccountStore, name = 'Main', dir = '/content/main') {
  return accounts.createWorkspace({ name, dir });
}

describe('comment threads', () => {
  it('opens a thread with its first comment and lists it back', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, {
      pageId: PAGE,
      author: ADA,
      body: '  Is this still true?  ',
      anchor: ANCHOR,
    });

    expect(thread.id.startsWith('ct_')).toBe(true);
    expect(thread.pageId).toBe(PAGE);
    expect(thread.resolved).toBe(false);
    expect(thread.resolvedBy).toBeNull();
    expect(thread.anchor).toEqual(ANCHOR);
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0]?.id.startsWith('cm_')).toBe(true);
    expect(thread.comments[0]?.author).toBe(ADA);
    expect(thread.comments[0]?.body).toBe('Is this still true?');
    expect(thread.comments[0]?.created).toBe(thread.comments[0]?.updated);

    expect(accounts.listThreads(main.id, PAGE)).toEqual([thread]);
  });

  it('keeps a page-level thread with no anchor', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'Nice page' });
    expect(thread.anchor).toBeNull();
    expect(accounts.getThread(main.id, thread.id)?.anchor).toBeNull();
  });

  it('lists threads oldest first and only for the page asked about', () => {
    const accounts = store();
    const main = workspace(accounts);

    const first = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    const second = accounts.createThread(main.id, { pageId: PAGE, author: GRACE, body: 'Two' });
    accounts.createThread(main.id, { pageId: OTHER_PAGE, author: ADA, body: 'Elsewhere' });

    expect(accounts.listThreads(main.id, PAGE).map((one) => one.id)).toEqual([first.id, second.id]);
    expect(accounts.listThreads(main.id, OTHER_PAGE)).toHaveLength(1);
  });

  it('refuses an empty body, a body that is too long and a missing author', () => {
    const accounts = store();
    const main = workspace(accounts);

    expect(codeOf(() => accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: '   ' }))).toBe(
      'VALIDATION',
    );
    expect(
      codeOf(() =>
        accounts.createThread(main.id, {
          pageId: PAGE,
          author: ADA,
          body: 'x'.repeat(MAX_COMMENT_LENGTH + 1),
        }),
      ),
    ).toBe('VALIDATION');
    expect(codeOf(() => accounts.createThread(main.id, { pageId: PAGE, author: ' ', body: 'Hi' }))).toBe(
      'VALIDATION',
    );
    expect(codeOf(() => accounts.createThread('ws_missing', { pageId: PAGE, author: ADA, body: 'Hi' }))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('replies', () => {
  it('appends a reply in order and moves the thread updated stamp', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' }, 1000);
    const replied = accounts.addReply(main.id, thread.id, GRACE, 'Two', 2000);

    expect(replied.comments.map((one) => one.body)).toEqual(['One', 'Two']);
    expect(replied.comments[1]?.author).toBe(GRACE);
    expect(replied.updated).toBe(new Date(2000).toISOString());
    expect(replied.created).toBe(thread.created);
  });

  it('refuses a reply to a thread in another workspace', () => {
    const accounts = store();
    const main = workspace(accounts);
    const other = workspace(accounts, 'Handbook', '/content/handbook');

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    expect(codeOf(() => accounts.addReply(other.id, thread.id, GRACE, 'Two'))).toBe('NOT_FOUND');
  });
});

describe('resolve', () => {
  it('records who resolved it and when, and reopens cleanly', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' }, 1000);
    const resolved = accounts.setThreadResolved(main.id, thread.id, true, GRACE, 2000);
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolvedBy).toBe(GRACE);
    expect(resolved.resolvedAt).toBe(new Date(2000).toISOString());

    const reopened = accounts.setThreadResolved(main.id, thread.id, false, ADA, 3000);
    expect(reopened.resolved).toBe(false);
    expect(reopened.resolvedBy).toBeNull();
    expect(reopened.resolvedAt).toBeNull();
  });

  it('refuses to resolve a thread in another workspace', () => {
    const accounts = store();
    const main = workspace(accounts);
    const other = workspace(accounts, 'Handbook', '/content/handbook');

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    expect(codeOf(() => accounts.setThreadResolved(other.id, thread.id, true, GRACE))).toBe('NOT_FOUND');
  });
});

describe('edit and delete', () => {
  it('rewrites a body and moves updated but not created', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' }, 1000);
    const id = thread.comments[0]!.id;
    const edited = accounts.updateComment(main.id, id, '  One, corrected  ', 2000);

    expect(edited.comments[0]?.body).toBe('One, corrected');
    expect(edited.comments[0]?.created).toBe(thread.comments[0]?.created);
    expect(edited.comments[0]?.updated).toBe(new Date(2000).toISOString());
  });

  it('moves updated even when the edit lands in the same millisecond', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' }, 1000);
    const id = thread.comments[0]!.id;
    const edited = accounts.updateComment(main.id, id, 'One, corrected', 1000);

    // The UI shows "edited" off this comparison, so a fast edit must not hide itself.
    expect(edited.comments[0]?.updated).not.toBe(edited.comments[0]?.created);
  });

  it('deletes a reply and keeps the thread', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    const replied = accounts.addReply(main.id, thread.id, GRACE, 'Two');
    const left = accounts.deleteComment(main.id, replied.comments[1]!.id);

    expect(left?.comments.map((one) => one.body)).toEqual(['One']);
    expect(accounts.listThreads(main.id, PAGE)).toHaveLength(1);
  });

  it('deletes the whole thread when the opening comment goes', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    accounts.addReply(main.id, thread.id, GRACE, 'Two');

    expect(accounts.deleteComment(main.id, thread.comments[0]!.id)).toBeNull();
    expect(accounts.listThreads(main.id, PAGE)).toEqual([]);
    expect(accounts.getThread(main.id, thread.id)).toBeNull();
  });

  it('hides a comment from another workspace', () => {
    const accounts = store();
    const main = workspace(accounts);
    const other = workspace(accounts, 'Handbook', '/content/handbook');

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    const id = thread.comments[0]!.id;

    expect(accounts.getComment(main.id, id)?.id).toBe(id);
    expect(accounts.getComment(other.id, id)).toBeNull();
    expect(codeOf(() => accounts.updateComment(other.id, id, 'Two'))).toBe('NOT_FOUND');
    expect(codeOf(() => accounts.deleteComment(other.id, id))).toBe('NOT_FOUND');
  });
});

describe('cascade', () => {
  it('drops every thread on a deleted page, and only in that workspace', () => {
    const accounts = store();
    const main = workspace(accounts);
    const other = workspace(accounts, 'Handbook', '/content/handbook');

    accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    accounts.createThread(main.id, { pageId: PAGE, author: GRACE, body: 'Two' });
    accounts.createThread(main.id, { pageId: OTHER_PAGE, author: ADA, body: 'Elsewhere' });
    accounts.createThread(other.id, { pageId: PAGE, author: ADA, body: 'Another workspace' });

    expect(accounts.deleteThreadsForPages(main.id, [PAGE])).toBe(2);
    expect(accounts.listThreads(main.id, PAGE)).toEqual([]);
    expect(accounts.listThreads(main.id, OTHER_PAGE)).toHaveLength(1);
    expect(accounts.listThreads(other.id, PAGE)).toHaveLength(1);
    expect(accounts.deleteThreadsForPages(main.id, [])).toBe(0);
  });

  it('takes the replies with the thread', () => {
    const accounts = store();
    const main = workspace(accounts);

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    accounts.addReply(main.id, thread.id, GRACE, 'Two');
    accounts.deleteThreadsForPages(main.id, [PAGE]);

    expect(accounts.getThread(main.id, thread.id)).toBeNull();
    expect(accounts.getComment(main.id, thread.comments[0]!.id)).toBeNull();
  });

  it('takes the threads with the workspace', () => {
    const accounts = store();
    const main = workspace(accounts);
    workspace(accounts, 'Handbook', '/content/handbook'); // the last workspace cannot be deleted

    const thread = accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'One' });
    accounts.deleteWorkspace(main.id);

    expect(accounts.getThread(main.id, thread.id)).toBeNull();
  });
});

describe('mentions in comments', () => {
  it('counts the comments that name a handle, across every workspace', () => {
    const accounts = store();
    const main = workspace(accounts);
    const other = workspace(accounts, 'Handbook', '/content/handbook');

    accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'ask @ada.lovelace' });
    accounts.createThread(other.id, { pageId: PAGE, author: GRACE, body: 'and @ada.lovelace too' });
    accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'nobody here' });

    expect(accounts.countCommentMentions('ada.lovelace')).toBe(2);
    expect(accounts.countCommentMentions('@Ada.Lovelace')).toBe(2);
    expect(accounts.countCommentMentions('nobody')).toBe(0);
  });

  it('rewrites the handle in every comment that carries it', () => {
    const accounts = store();
    const main = workspace(accounts);
    const thread = accounts.createThread(main.id, {
      pageId: PAGE,
      author: ADA,
      body: 'ask @ada.lovelace',
    });
    accounts.addReply(main.id, thread.id, GRACE, 'yes, @ada.lovelace knows');

    expect(accounts.renameCommentMentions('ada.lovelace', 'ada.king')).toBe(2);

    const after = accounts.getThread(main.id, thread.id);
    expect(after?.comments[0]?.body).toBe('ask @ada.king');
    expect(after?.comments[1]?.body).toBe('yes, @ada.king knows');
  });

  it('does not mark a rewritten comment as edited', () => {
    const accounts = store();
    const main = workspace(accounts);
    const thread = accounts.createThread(main.id, {
      pageId: PAGE,
      author: ADA,
      body: 'ask @ada.lovelace',
    });

    accounts.renameCommentMentions('ada.lovelace', 'ada.king');

    const comment = accounts.getThread(main.id, thread.id)?.comments[0];
    expect(comment?.updated).toBe(comment?.created);
  });

  it('leaves a comment that names somebody else alone', () => {
    const accounts = store();
    const main = workspace(accounts);
    const thread = accounts.createThread(main.id, {
      pageId: PAGE,
      author: ADA,
      body: 'ask @ada.lovelace.2 and `@ada.lovelace`',
    });

    expect(accounts.renameCommentMentions('ada.lovelace', 'ada.king')).toBe(0);
    expect(accounts.getThread(main.id, thread.id)?.comments[0]?.body).toBe(
      'ask @ada.lovelace.2 and `@ada.lovelace`',
    );
  });

  it('counts exactly what it rewrites, so the preview cannot promise the wrong number', () => {
    const accounts = store();
    const main = workspace(accounts);
    const bodies = [
      'ask @ada.lovelace',
      'and @Ada.Lovelace in another case',
      'not @ada.lovelace.2, somebody else',
      '`@ada.lovelace` is code',
      'ada.lovelace without the @',
      'nobody here',
    ];
    for (const body of bodies) {
      accounts.createThread(main.id, { pageId: PAGE, author: ADA, body });
    }

    const counted = accounts.countCommentMentions('ada.lovelace');
    expect(counted).toBe(2);
    expect(accounts.renameCommentMentions('ada.lovelace', 'ada.king')).toBe(counted);
  });

  it('finds a handle with an underscore, which LIKE would otherwise read as a wildcard', () => {
    const accounts = store();
    const main = workspace(accounts);
    accounts.createThread(main.id, { pageId: PAGE, author: ADA, body: 'ask @ada_lovelace' });

    expect(accounts.countCommentMentions('ada_lovelace')).toBe(1);
    expect(accounts.renameCommentMentions('ada_lovelace', 'ada.king')).toBe(1);
  });
});
