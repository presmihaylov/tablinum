/**
 * Comment threads and the comments inside them.
 *
 * Every function takes the open handle first and the workspace id second, and every statement
 * filters on that id, so a thread in one workspace is unreachable from another even when its id
 * is known. The route layer checks membership; this is the second lock behind it.
 */
import {
  CommentAnchorSchema,
  MAX_COMMENT_LENGTH,
  findMentions,
  isPropertyId,
  newCommentId,
  newThreadId,
  normalizeHandle,
  notFound,
  renameMentions,
  validation,
  type Comment,
  type CommentAnchor,
  type CommentThread,
} from '@tablinum/shared';
import { iso, type Db } from './db.js';

export interface CreateThreadInput {
  pageId: string;
  /** The account that opened the thread. */
  author: string;
  body: string;
  /** Left out for a comment about the whole page. */
  anchor?: CommentAnchor | null;
  /** The property id of the database column the thread is about. */
  column?: string | null;
}

interface ThreadRow {
  id: string;
  page_id: string;
  anchor: string | null;
  column_id: string | null;
  resolved_by: string | null;
  resolved_at: number | null;
  created: number;
  updated: number;
}

interface CommentRow {
  id: string;
  thread_id: string;
  author: string;
  body: string;
  created: number;
  updated: number;
}

const THREAD_COLUMNS =
  'id, page_id, anchor, column_id, resolved_by, resolved_at, created, updated';

const COMMENT_COLUMNS = 'id, thread_id, author, body, created, updated';

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    threadId: row.thread_id,
    author: row.author,
    body: row.body,
    created: iso(row.created),
    updated: iso(row.updated),
  };
}

/** A stored anchor that no longer parses is treated as a page comment rather than thrown away. */
function readAnchor(raw: string | null): CommentAnchor | null {
  if (raw === null) return null;
  try {
    const parsed = CommentAnchorSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A column id the file no longer holds a valid value for reads as no column at all. */
function readColumn(raw: string | null): string | null {
  return isPropertyId(raw) ? raw : null;
}

function toThread(row: ThreadRow, comments: Comment[]): CommentThread {
  return {
    id: row.id,
    pageId: row.page_id,
    anchor: readAnchor(row.anchor),
    column: readColumn(row.column_id),
    resolved: row.resolved_at !== null,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at === null ? null : iso(row.resolved_at),
    created: iso(row.created),
    updated: iso(row.updated),
    comments,
  };
}

/** Trim a body and refuse an empty or oversized one, wherever the write came from. */
function cleanBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw validation('A comment needs a body');
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw validation(`A comment must be ${MAX_COMMENT_LENGTH} characters or shorter`);
  }
  return trimmed;
}

/** The `?, ?, ?` of an `IN` list, so a set of ids is one statement rather than a loop. */
function marks(n: number): string {
  return new Array(n).fill('?').join(', ');
}

/** Every thread on a page, oldest first. Replies come with each thread. */
export function listThreads(db: Db, workspaceId: string, pageId: string): CommentThread[] {
  const rows = db
    .prepare(
      `SELECT ${THREAD_COLUMNS} FROM comment_threads
       WHERE workspace_id = ? AND page_id = ? ORDER BY created, id`,
    )
    .all(workspaceId, pageId) as ThreadRow[];
  if (rows.length === 0) return [];

  const byThread = new Map<string, Comment[]>(rows.map((row) => [row.id, []]));
  const comments = db
    .prepare(
      `SELECT c.${COMMENT_COLUMNS.split(', ').join(', c.')} FROM comments c
       JOIN comment_threads t ON t.id = c.thread_id
       WHERE t.workspace_id = ? AND t.page_id = ? ORDER BY c.created, c.id`,
    )
    .all(workspaceId, pageId) as CommentRow[];
  for (const row of comments) byThread.get(row.thread_id)?.push(toComment(row));

  // A thread whose comments are all gone cannot happen, but it must never reach the wire.
  return rows
    .map((row) => toThread(row, byThread.get(row.id) ?? []))
    .filter((thread) => thread.comments.length > 0);
}

export function getThread(db: Db, workspaceId: string, threadId: string): CommentThread | null {
  const row = db
    .prepare(`SELECT ${THREAD_COLUMNS} FROM comment_threads WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, threadId) as ThreadRow | undefined;
  if (row === undefined) return null;

  const comments = db
    .prepare(`SELECT ${COMMENT_COLUMNS} FROM comments WHERE thread_id = ? ORDER BY created, id`)
    .all(threadId) as CommentRow[];
  if (comments.length === 0) return null;
  return toThread(row, comments.map(toComment));
}

/** Open a thread. Its first comment is written in the same transaction. */
export function createThread(
  db: Db,
  workspaceId: string,
  input: CreateThreadInput,
  now: number = Date.now(),
): CommentThread {
  requireWorkspace(db, workspaceId);
  if (input.pageId.trim().length === 0) throw validation('A page id is required');
  const body = cleanBody(input.body);
  const anchor = input.anchor ?? null;
  const column = input.column ?? null;
  if (anchor !== null && column !== null) {
    throw validation('A thread is about a selection or about a column, not both');
  }
  if (column !== null && !isPropertyId(column)) {
    throw validation(`${JSON.stringify(column)} is not a property id`);
  }

  const threadId = newThreadId(now);
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO comment_threads (id, workspace_id, page_id, anchor, column_id, resolved_by, resolved_at, created, updated)
       VALUES (@id, @workspaceId, @pageId, @anchor, @column, NULL, NULL, @now, @now)`,
    ).run({
      id: threadId,
      workspaceId,
      pageId: input.pageId,
      anchor: anchor === null ? null : JSON.stringify(anchor),
      column,
      now,
    });
    insertComment(db, threadId, input.author, body, now);
  });
  write();

  return requireThread(db, workspaceId, threadId);
}

/** Add a reply to an open thread. A resolved thread is reopened by unresolving it first. */
export function addReply(
  db: Db,
  workspaceId: string,
  threadId: string,
  author: string,
  body: string,
  now: number = Date.now(),
): CommentThread {
  requireThread(db, workspaceId, threadId);
  const clean = cleanBody(body);
  const write = db.transaction(() => {
    insertComment(db, threadId, author, clean, now);
    touchThread(db, threadId, now);
  });
  write();
  return requireThread(db, workspaceId, threadId);
}

/** Mark a thread answered, or put it back. `by` is the account that pressed the button. */
export function setThreadResolved(
  db: Db,
  workspaceId: string,
  threadId: string,
  resolved: boolean,
  by: string,
  now: number = Date.now(),
): CommentThread {
  requireThread(db, workspaceId, threadId);
  db.prepare(
    `UPDATE comment_threads SET resolved_at = @resolvedAt, resolved_by = @resolvedBy, updated = @now
     WHERE workspace_id = @workspaceId AND id = @id`,
  ).run({
    id: threadId,
    workspaceId,
    resolvedAt: resolved ? now : null,
    resolvedBy: resolved ? by : null,
    now,
  });
  return requireThread(db, workspaceId, threadId);
}

/** One comment, or null when it is not in this workspace. The route reads `author` off it. */
export function getComment(db: Db, workspaceId: string, commentId: string): Comment | null {
  const row = db
    .prepare(
      `SELECT c.${COMMENT_COLUMNS.split(', ').join(', c.')} FROM comments c
       JOIN comment_threads t ON t.id = c.thread_id
       WHERE t.workspace_id = ? AND c.id = ?`,
    )
    .get(workspaceId, commentId) as CommentRow | undefined;
  return row === undefined ? null : toComment(row);
}

/** Rewrite a body. Only `updated` moves, so the UI can show that it was edited. */
export function updateComment(
  db: Db,
  workspaceId: string,
  commentId: string,
  body: string,
  now: number = Date.now(),
): CommentThread {
  const comment = getComment(db, workspaceId, commentId);
  if (comment === null) throw notFound(`No comment with id ${commentId}`);
  const clean = cleanBody(body);
  // An edit inside the same millisecond must still read as an edit, so the stamp always moves.
  const stamp = Math.max(now, Date.parse(comment.created) + 1);

  const write = db.transaction(() => {
    db.prepare('UPDATE comments SET body = ?, updated = ? WHERE id = ?').run(
      clean,
      stamp,
      commentId,
    );
    touchThread(db, comment.threadId, stamp);
  });
  write();
  return requireThread(db, workspaceId, comment.threadId);
}

/**
 * Remove one comment. Removing the comment that opened the thread removes the thread and
 * every reply with it, because a reply with nothing above it reads as a comment on nothing.
 * Returns the thread that is left, or null when the whole thread went.
 */
export function deleteComment(
  db: Db,
  workspaceId: string,
  commentId: string,
  now: number = Date.now(),
): CommentThread | null {
  const comment = getComment(db, workspaceId, commentId);
  if (comment === null) throw notFound(`No comment with id ${commentId}`);
  const thread = requireThread(db, workspaceId, comment.threadId);

  if (thread.comments[0]?.id === commentId) {
    db.prepare('DELETE FROM comment_threads WHERE workspace_id = ? AND id = ?').run(
      workspaceId,
      thread.id,
    );
    return null;
  }

  const write = db.transaction(() => {
    db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
    touchThread(db, thread.id, now);
  });
  write();
  return requireThread(db, workspaceId, thread.id);
}

/**
 * Drop every thread on the given pages. Pages live in git rather than in this database, so
 * there is no foreign key to cascade: the page route calls this after a delete.
 */
export function deleteThreadsForPages(
  db: Db,
  workspaceId: string,
  pageIds: readonly string[],
): number {
  if (pageIds.length === 0) return 0;
  return db
    .prepare(
      `DELETE FROM comment_threads WHERE workspace_id = ? AND page_id IN (${marks(pageIds.length)})`,
    )
    .run(workspaceId, ...pageIds).changes;
}

/**
 * Drop every thread about the given columns of one page. A column thread names only a property
 * id, so once the column is gone there is nothing left for a reader to recognise it by: the
 * conversation goes with the column rather than lingering as an unanswerable card.
 */
export function deleteThreadsForColumns(
  db: Db,
  workspaceId: string,
  pageId: string,
  columnIds: readonly string[],
): number {
  if (columnIds.length === 0) return 0;
  return db
    .prepare(
      `DELETE FROM comment_threads
       WHERE workspace_id = ? AND page_id = ? AND column_id IN (${marks(columnIds.length)})`,
    )
    .run(workspaceId, pageId, ...columnIds).changes;
}

/**
 * Every comment that carries `@handle` right now, across every workspace.
 *
 * The count and the rewrite below both come from here. The preview is what a person agrees
 * to, so a count that could disagree with the rewrite would be a consent bug rather than an
 * untidiness.
 *
 * LIKE narrows the scan to the few rows that could carry the handle; `_` in a handle is a
 * LIKE wildcard, which only ever hands back extra rows, and findMentions() is what decides.
 */
function commentsMentioning(db: Db, handle: string): { id: string; body: string }[] {
  const wanted = normalizeHandle(handle);
  const rows = db
    .prepare("SELECT id, body FROM comments WHERE body LIKE '%@' || ? || '%'")
    .all(wanted) as { id: string; body: string }[];
  return rows.filter((row) => findMentions(row.body).includes(wanted));
}

/** How many comments carry `@handle` right now, across every workspace. */
export function countCommentMentions(db: Db, handle: string): number {
  return commentsMentioning(db, handle).length;
}

/**
 * Rewrite `@from` as `@to` in every comment that carries it. Returns how many changed.
 *
 * `updated` is deliberately left alone: the author did not edit their remark, so the card
 * must not start claiming they did.
 */
export function renameCommentMentions(db: Db, from: string, to: string): number {
  const before = normalizeHandle(from);
  const after = normalizeHandle(to);
  const rows = commentsMentioning(db, before);
  const update = db.prepare('UPDATE comments SET body = ? WHERE id = ?');

  const write = db.transaction(() => {
    let changed = 0;
    for (const row of rows) {
      const body = renameMentions(row.body, before, after);
      if (body === row.body) continue;
      update.run(body, row.id);
      changed += 1;
    }
    return changed;
  });
  return write();
}

/** A thread names its workspace, so a missing one must read as a 404 and not a foreign key error. */
function requireWorkspace(db: Db, workspaceId: string): void {
  const row = db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(workspaceId);
  if (row === undefined) throw notFound(`No workspace with id ${workspaceId}`);
}

function insertComment(db: Db, threadId: string, author: string, body: string, now: number): void {
  if (author.trim().length === 0) throw validation('An author is required');
  db.prepare(
    `INSERT INTO comments (id, thread_id, author, body, created, updated)
     VALUES (@id, @threadId, @author, @body, @now, @now)`,
  ).run({ id: newCommentId(now), threadId, author, body, now });
}

function touchThread(db: Db, threadId: string, now: number): void {
  db.prepare('UPDATE comment_threads SET updated = ? WHERE id = ?').run(now, threadId);
}

function requireThread(db: Db, workspaceId: string, threadId: string): CommentThread {
  const thread = getThread(db, workspaceId, threadId);
  if (thread === null) throw notFound(`No comment thread with id ${threadId}`);
  return thread;
}
