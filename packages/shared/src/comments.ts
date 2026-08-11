import { z } from 'zod';
import { PropertyIdSchema } from './databases.js';
import { newUlid } from './ids.js';
import { IsoDateSchema, PageIdSchema } from './schemas.js';

/**
 * Comments.
 *
 * A comment is a conversation about a page, not part of the page. Bodies live in the account
 * database and never touch the markdown file, so a page read on a git remote carries no comment
 * id, no highlight span and no discussion. A thread anchors to the text it is about by quoting
 * it, in the style of a W3C TextQuoteSelector: the quote itself, a little text on each side to
 * tell two identical quotes apart, and the offset it was taken from. The browser looks that
 * quote up again in the document on every load.
 *
 * The failure mode is deliberate. When the quote is no longer in the page the thread is marked
 * orphaned and stays readable in the panel with its quote shown; nothing is guessed and no
 * fuzzy match is attempted, so a comment can never point at a sentence it was not written about.
 *
 * A thread can also be about a column of a database instead of about a run of text. It holds the
 * property id, not the column name, so renaming the column keeps the conversation.
 */

/** Prefix of a comment thread id, in the style of the page and user ids. */
export const THREAD_ID_PREFIX = 'ct_';

/** Prefix of a single comment id. */
export const COMMENT_ID_PREFIX = 'cm_';

const THREAD_ID_RE = /^ct_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const COMMENT_ID_RE = /^cm_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export const isThreadId = (value: unknown): value is string =>
  typeof value === 'string' && THREAD_ID_RE.test(value);

export const isCommentId = (value: unknown): value is string =>
  typeof value === 'string' && COMMENT_ID_RE.test(value);

export const ThreadIdSchema = z.string().refine(isThreadId, 'Expected a thread id like "ct_<ULID>"');
export const CommentIdSchema = z
  .string()
  .refine(isCommentId, 'Expected a comment id like "cm_<ULID>"');

/** Longest comment body the server stores. A comment is a remark, not a page. */
export const MAX_COMMENT_LENGTH = 5000;

/** Longest quote a thread may anchor to. A longer selection is anchored by its opening. */
export const MAX_QUOTE_LENGTH = 300;

/** How much text on each side of the quote is kept, to tell two identical quotes apart. */
export const ANCHOR_CONTEXT_LENGTH = 40;

/**
 * Where a thread sits in the page, as text rather than as a position. `start` is only a hint
 * used to pick the nearest of several matches; the quote and the two context strings are what
 * actually identify the place.
 */
export const CommentAnchorSchema = z.object({
  quote: z.string().min(1).max(MAX_QUOTE_LENGTH),
  prefix: z.string().max(ANCHOR_CONTEXT_LENGTH),
  suffix: z.string().max(ANCHOR_CONTEXT_LENGTH),
  /** Character offset the quote was taken from when the thread was written. */
  start: z.number().int().min(0),
});

export const CommentSchema = z.object({
  id: CommentIdSchema,
  threadId: ThreadIdSchema,
  /** The account that wrote it. The roster turns this into a name and an avatar. */
  author: z.string(),
  /** CommonMark. Rendered with HTML off, so a body can never inject markup. */
  body: z.string(),
  created: IsoDateSchema,
  /** Equal to `created` until the author edits the comment. */
  updated: IsoDateSchema,
});

export const CommentThreadSchema = z.object({
  id: ThreadIdSchema,
  pageId: PageIdSchema,
  /** Null for a thread about the whole page rather than about one selection. */
  anchor: CommentAnchorSchema.nullable(),
  /**
   * The property id of the database column this thread is about, or null. An id rather than a
   * name, so a renamed column keeps its thread. Never set together with `anchor`.
   */
  column: PropertyIdSchema.nullable(),
  resolved: z.boolean(),
  resolvedBy: z.string().nullable(),
  resolvedAt: IsoDateSchema.nullable(),
  created: IsoDateSchema,
  updated: IsoDateSchema,
  /** The opening comment first, then every reply in the order it was written. */
  comments: z.array(CommentSchema).min(1),
});

// ---------------------------------------------------------------------------
// request bodies
// ---------------------------------------------------------------------------

export const CommentBodySchema = z.string().trim().min(1).max(MAX_COMMENT_LENGTH);

export const CreateThreadBodySchema = z
  .object({
    body: CommentBodySchema,
    /** Omit both for a comment about the whole page. */
    anchor: CommentAnchorSchema.optional(),
    /** The database column the thread is about. */
    column: PropertyIdSchema.optional(),
  })
  // A thread is about one thing. Both at once has no place to be drawn and no meaning.
  .refine(
    (value) => value.anchor === undefined || value.column === undefined,
    'A thread is about a selection or about a column, not both',
  );

export const ReplyBodySchema = z.object({ body: CommentBodySchema });

export const UpdateCommentBodySchema = z.object({ body: CommentBodySchema });

export const ResolveThreadBodySchema = z.object({ resolved: z.boolean() });

export const CommentsQuerySchema = z.object({
  /** Leave it out for every thread. `true` or `false` narrows to one side. */
  resolved: z.enum(['true', 'false']).optional(),
  /** Narrow to the threads about one database column. */
  column: PropertyIdSchema.optional(),
});

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

export const CommentThreadsResponseSchema = z.object({ threads: z.array(CommentThreadSchema) });
export const CommentThreadResponseSchema = z.object({ thread: CommentThreadSchema });

/** Null when the deleted comment opened the thread, which takes the whole thread with it. */
export const DeleteCommentResponseSchema = z.object({ thread: CommentThreadSchema.nullable() });

// ---------------------------------------------------------------------------
// inferred types
// ---------------------------------------------------------------------------

export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type CommentThread = z.infer<typeof CommentThreadSchema>;

export type CreateThreadBody = z.infer<typeof CreateThreadBodySchema>;
export type ReplyBody = z.infer<typeof ReplyBodySchema>;
export type UpdateCommentBody = z.infer<typeof UpdateCommentBodySchema>;
export type ResolveThreadBody = z.infer<typeof ResolveThreadBodySchema>;
export type CommentsQuery = z.infer<typeof CommentsQuerySchema>;

export type CommentThreadsResponse = z.infer<typeof CommentThreadsResponseSchema>;
export type CommentThreadResponse = z.infer<typeof CommentThreadResponseSchema>;
export type DeleteCommentResponse = z.infer<typeof DeleteCommentResponseSchema>;

export const newThreadId = (now?: number): string => THREAD_ID_PREFIX + newUlid(now);
export const newCommentId = (now?: number): string => COMMENT_ID_PREFIX + newUlid(now);

/** How many threads still want an answer. The number the UI puts on the comments button. */
export function unresolvedCount(threads: readonly CommentThread[]): number {
  return threads.filter((thread) => !thread.resolved).length;
}

/** The one thing a thread is about. `page` is the case where neither of the two fields is set. */
export type ThreadTarget =
  | { kind: 'quote'; anchor: CommentAnchor }
  | { kind: 'column'; column: string }
  | { kind: 'page' };

/**
 * What a thread or a draft is about, read once. The wire carries two nullable fields that are
 * never both set, so every reader would otherwise re-derive the three cases by hand.
 */
export function threadTarget(thread: {
  anchor: CommentAnchor | null;
  column: string | null;
}): ThreadTarget {
  if (thread.column !== null) return { kind: 'column', column: thread.column };
  if (thread.anchor !== null) return { kind: 'quote', anchor: thread.anchor };
  return { kind: 'page' };
}

/** The threads about one database column, oldest first, in the order they were given. */
export function threadsForColumn(
  threads: readonly CommentThread[],
  columnId: string,
): CommentThread[] {
  return threads.filter((thread) => thread.column === columnId);
}
