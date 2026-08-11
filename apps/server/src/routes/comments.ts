import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CommentIdSchema,
  CommentsQuerySchema,
  CreateThreadBodySchema,
  ReplyBodySchema,
  ResolveThreadBodySchema,
  ThreadIdSchema,
  UpdateCommentBodySchema,
  columnName,
  notFound,
  parseOrThrow,
  threadsForColumn,
  unauthorized,
  validation,
  type CommentThread,
  type CommentThreadResponse,
  type CommentThreadsResponse,
  type DeleteCommentResponse,
  type Page,
  type Writer,
} from '@tablinum/shared';
import { requireAccount, writerOf } from '../auth.js';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';
import { clientOf } from '../live.js';

const PageParamsSchema = z.object({ id: z.string().min(1) });
const ThreadParamsSchema = z.object({ id: ThreadIdSchema });
const CommentParamsSchema = z.object({ id: CommentIdSchema });

/**
 * The workspace this caller may work in.
 *
 * An account has to be in it, an agent token names exactly one and cannot be pointed at
 * another, and operator credentials reach all of them. The workspace hook already refuses a
 * workspace the caller cannot open, and every store method takes this id, so a thread in one
 * workspace stays unreachable from another even when somebody knows its id.
 */
function workspaceFor(ctx: RouteContext, request: FastifyRequest): string {
  const id = request.workspace.id;
  if (request.principal.admin || request.principal.agent !== null) return id;
  const me = requireAccount(request);
  const allowed = ctx.deps.accounts.listWorkspacesFor(me.id);
  if (allowed.some((one) => one.id === id)) return id;
  throw unauthorized('You are not in this workspace');
}

/**
 * Who is writing, and where. An agent authors a remark exactly as a person does, under its own
 * name. An operator token names nobody, so it still reads comments without writing one.
 */
function writerFor(
  ctx: RouteContext,
  request: FastifyRequest,
): { writer: Writer; workspaceId: string } {
  const workspaceId = workspaceFor(ctx, request);
  const writer = writerOf(request);
  if (writer === null) throw unauthorized('Sign in with an account to do that');
  return { writer, workspaceId };
}

/** The page a thread is about, or a 404. A page in another workspace is simply not there. */
async function requirePage(
  ctx: RouteContext,
  request: FastifyRequest,
  id: string,
): Promise<Page> {
  const { store } = await partsOf(ctx, request);
  const page = await store.getPageById(id);
  if (page === null) throw notFound(`No page with id ${id}`);
  return page;
}

/**
 * A column thread names a column the page's database actually has. A thread pointing at a
 * column nobody can see would never be readable, so it is refused rather than stored.
 */
function requireColumnOn(page: Page, columnId: string | undefined): string | null {
  if (columnId === undefined) return null;
  const database = page.database;
  if (database === undefined || columnName(database, columnId) === null) {
    throw validation(`No column with id ${columnId} on ${page.path}`);
  }
  return columnId;
}

export function registerCommentRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { accounts } = ctx.deps;

  /** Tell the other tabs on this page to read the threads again. */
  async function announce(request: FastifyRequest, pageId: string): Promise<void> {
    const { live } = await partsOf(ctx, request);
    live.commentsChanged(pageId, clientOf(request));
  }

  /**
   * Tell whoever the body newly names. The comment is already written, so a mention that
   * cannot be delivered never costs the writer their remark.
   */
  async function notify(
    request: FastifyRequest,
    thread: CommentThread,
    body: string,
    before: string | null,
    by: Writer,
    workspaceId: string,
  ): Promise<void> {
    const { store } = await partsOf(ctx, request);
    const page = await store.getPageById(thread.pageId);
    if (page === null) return;
    ctx.mentions.commentPosted({ page, body, before, by, workspaceId, threadId: thread.id });
  }

  app.get(`${API_PREFIX}/pages/:id/comments`, async (request): Promise<CommentThreadsResponse> => {
    const workspaceId = workspaceFor(ctx, request);
    const { id } = parseOrThrow(PageParamsSchema, request.params, 'page id');
    const query = parseOrThrow(CommentsQuerySchema, request.query, 'query');
    const page = await requirePage(ctx, request, id);

    const all = accounts.listThreads(workspaceId, page.id);
    const threads = query.column === undefined ? all : threadsForColumn(all, query.column);
    if (query.resolved === undefined) return { threads };
    const wanted = query.resolved === 'true';
    return { threads: threads.filter((thread) => thread.resolved === wanted) };
  });

  app.post(`${API_PREFIX}/pages/:id/comments`, async (request, reply): Promise<CommentThreadResponse> => {
    const { writer, workspaceId } = writerFor(ctx, request);
    const { id } = parseOrThrow(PageParamsSchema, request.params, 'page id');
    const body = parseOrThrow(CreateThreadBodySchema, request.body, 'comment');
    const page = await requirePage(ctx, request, id);
    const column = requireColumnOn(page, body.column);
    const pageId = page.id;

    const thread = accounts.createThread(workspaceId, {
      pageId,
      author: writer.id,
      body: body.body,
      anchor: body.anchor ?? null,
      column,
    });
    await announce(request, pageId);
    await notify(request, thread, body.body, null, writer, workspaceId);

    reply.status(201);
    return { thread };
  });

  app.post(
    `${API_PREFIX}/comment-threads/:id/replies`,
    async (request, reply): Promise<CommentThreadResponse> => {
      const { writer, workspaceId } = writerFor(ctx, request);
      const { id } = parseOrThrow(ThreadParamsSchema, request.params, 'thread id');
      const body = parseOrThrow(ReplyBodySchema, request.body, 'reply');

      const thread = accounts.addReply(workspaceId, id, writer.id, body.body);
      await announce(request, thread.pageId);
      await notify(request, thread, body.body, null, writer, workspaceId);
      reply.status(201);
      return { thread };
    },
  );

  /** Resolve or reopen a thread. Anybody in the workspace may, not only the author. */
  app.patch(`${API_PREFIX}/comment-threads/:id`, async (request): Promise<CommentThreadResponse> => {
    const { writer, workspaceId } = writerFor(ctx, request);
    const { id } = parseOrThrow(ThreadParamsSchema, request.params, 'thread id');
    const body = parseOrThrow(ResolveThreadBodySchema, request.body, 'thread');

    const thread = accounts.setThreadResolved(workspaceId, id, body.resolved, writer.id);
    await announce(request, thread.pageId);
    return { thread };
  });

  app.patch(`${API_PREFIX}/comments/:id`, async (request): Promise<CommentThreadResponse> => {
    const { writer, workspaceId } = writerFor(ctx, request);
    const { id } = parseOrThrow(CommentParamsSchema, request.params, 'comment id');
    const body = parseOrThrow(UpdateCommentBodySchema, request.body, 'comment');

    const comment = accounts.getComment(workspaceId, id);
    if (comment === null) throw notFound(`No comment with id ${id}`);
    // Editing is stricter than deleting: an admin may remove a remark but never reword one.
    if (comment.author !== writer.id) throw unauthorized('You can only edit your own comment');

    const thread = accounts.updateComment(workspaceId, id, body.body);
    await announce(request, thread.pageId);
    // Only what the edit adds: a handle that was already there was told about once.
    await notify(request, thread, body.body, comment.body, writer, workspaceId);
    return { thread };
  });

  app.delete(`${API_PREFIX}/comments/:id`, async (request): Promise<DeleteCommentResponse> => {
    const workspaceId = workspaceFor(ctx, request);
    const { id } = parseOrThrow(CommentParamsSchema, request.params, 'comment id');

    const comment = accounts.getComment(workspaceId, id);
    if (comment === null) throw notFound(`No comment with id ${id}`);
    const me = request.principal.agent ?? request.principal.account;
    const mine = me !== null && me.id === comment.author;
    if (!mine && !request.principal.admin) {
      throw unauthorized('You can only delete your own comment');
    }

    const before = accounts.getThread(workspaceId, comment.threadId);
    const thread: CommentThread | null = accounts.deleteComment(workspaceId, id);
    if (before !== null) await announce(request, before.pageId);
    return { thread };
  });
}
