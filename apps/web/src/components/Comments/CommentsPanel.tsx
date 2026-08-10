import { useEffect, useMemo, useRef, useState } from 'react';
import type { Account, Comment, CommentThread } from '@tablinum/shared';
import {
  useCreateThread,
  useDeleteComment,
  useReplyToThread,
  useResolveThread,
  useUpdateComment,
  useUsers,
} from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import { useComments } from '../../lib/comments';
import { absoluteTime, relativeTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { Avatar, type AvatarPerson } from '../Account/Avatar';
import { Check, Close } from '../ui/Icon';
import { ConfirmDialog, type ConfirmRequest } from '../ui/ConfirmDialog';
import { renderCommentBody } from './render';
import './comments.css';

/** Somebody who has left the workspace still owns their remarks; only their name is gone. */
const GONE: Omit<AvatarPerson, 'id'> = { name: 'A former member', color: 'var(--text-faint)' };

function peopleById(users: Account[]): Map<string, Account> {
  return new Map(users.map((user) => [user.id, user]));
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  busy: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

function Composer({
  placeholder,
  submitLabel,
  initial = '',
  autoFocus = false,
  busy,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const submit = (): void => {
    const body = value.trim();
    if (body.length === 0) return;
    onSubmit(body);
    setValue('');
  };

  return (
    <div className="comments__composer">
      <textarea
        ref={ref}
        className="input comments__input"
        rows={3}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="comments__composer-row">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || value.trim().length === 0}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface CommentRowProps {
  comment: Comment;
  person: AvatarPerson;
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
}

function CommentRow({ comment, person, canEdit, canDelete, busy, onEdit, onDelete }: CommentRowProps) {
  const [editing, setEditing] = useState(false);
  const edited = comment.updated !== comment.created;

  return (
    <li className="comment">
      <Avatar person={person} size={20} />
      <div className="comment__body">
        <div className="comment__meta">
          <span className="comment__author">{person.name}</span>
          <time className="comment__time" title={absoluteTime(comment.created)}>
            {relativeTime(comment.created)}
          </time>
          {edited ? <span className="comment__edited">edited</span> : null}
        </div>

        {editing ? (
          <Composer
            placeholder="Edit the comment"
            submitLabel="Save"
            initial={comment.body}
            autoFocus
            busy={busy}
            onCancel={() => setEditing(false)}
            onSubmit={(body) => {
              setEditing(false);
              onEdit(body);
            }}
          />
        ) : (
          <div
            className="comment__text"
            // Rendered by a markdown-it with raw HTML turned off; see render.ts.
            dangerouslySetInnerHTML={{ __html: renderCommentBody(comment.body) }}
          />
        )}

        {editing ? null : (
          <div className="comment__actions">
            {canEdit ? (
              <button type="button" className="comments__link" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : null}
            {canDelete ? (
              <button type="button" className="comments__link" onClick={onDelete}>
                Delete
              </button>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

interface ThreadCardProps {
  thread: CommentThread;
  active: boolean;
  orphaned: boolean;
  busy: boolean;
  personFor: (userId: string) => AvatarPerson;
  canEdit: (comment: Comment) => boolean;
  canDelete: (comment: Comment) => boolean;
  onFocus: () => void;
  onReply: (body: string) => void;
  onResolve: (resolved: boolean) => void;
  onEdit: (comment: Comment, body: string) => void;
  onDelete: (comment: Comment) => void;
}

function ThreadCard({
  thread,
  active,
  orphaned,
  busy,
  personFor,
  canEdit,
  canDelete,
  onFocus,
  onReply,
  onResolve,
  onEdit,
  onDelete,
}: ThreadCardProps) {
  const [replying, setReplying] = useState(false);
  const classes = ['comments__thread'];
  if (active) classes.push('comments__thread--active');
  if (thread.resolved) classes.push('comments__thread--resolved');

  return (
    <li
      className={classes.join(' ')}
      data-thread-id={thread.id}
      onClick={onFocus}
      onFocusCapture={onFocus}
    >
      <div className="comments__quote">
        {thread.anchor === null ? (
          <span className="comments__quote-none">On the whole page</span>
        ) : (
          <q className={orphaned ? 'comments__quote-text is-gone' : 'comments__quote-text'}>
            {thread.anchor.quote}
          </q>
        )}
      </div>

      {orphaned && thread.anchor !== null ? (
        <p className="comments__orphan">This text is no longer on the page.</p>
      ) : null}

      <ul className="comments__comments">
        {thread.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            person={personFor(comment.author)}
            canEdit={canEdit(comment)}
            canDelete={canDelete(comment)}
            busy={busy}
            onEdit={(body) => onEdit(comment, body)}
            onDelete={() => onDelete(comment)}
          />
        ))}
      </ul>

      {replying ? (
        <Composer
          placeholder="Reply"
          submitLabel="Reply"
          autoFocus
          busy={busy}
          onCancel={() => setReplying(false)}
          onSubmit={(body) => {
            setReplying(false);
            onReply(body);
          }}
        />
      ) : (
        <div className="comments__thread-actions">
          <button type="button" className="btn" onClick={() => setReplying(true)}>
            Reply
          </button>
          <button
            type="button"
            className={thread.resolved ? 'btn' : 'btn btn--outline'}
            disabled={busy}
            onClick={() => onResolve(!thread.resolved)}
          >
            {thread.resolved ? 'Reopen' : <><Check size={12} /> Resolve</>}
          </button>
        </div>
      )}
    </li>
  );
}

/** The side panel: every thread on the open page, newest business at the bottom of each. */
export function CommentsPanel() {
  const comments = useComments();
  const { user } = useAuth();
  const users = useUsers();
  const toast = useToast();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const createThread = useCreateThread();
  const reply = useReplyToThread();
  const resolve = useResolveThread();
  const update = useUpdateComment();
  const remove = useDeleteComment();

  const roster = useMemo(() => peopleById(users.data?.users ?? []), [users.data]);
  const pageId = comments.pageId;

  const busy =
    createThread.isPending ||
    reply.isPending ||
    resolve.isPending ||
    update.isPending ||
    remove.isPending;

  const personFor = (userId: string): AvatarPerson => {
    const person = roster.get(userId);
    if (person === undefined) return { id: userId, ...GONE };
    return { id: person.id, name: person.name, color: person.color, avatarRev: person.avatarRev };
  };

  const isAdmin = user?.role === 'admin';
  const canEdit = (comment: Comment): boolean => comment.author === user?.id;
  // An admin can take a remark down, but nobody may reword somebody else's.
  const canDelete = (comment: Comment): boolean => canEdit(comment) || isAdmin;

  const visible = comments.threads.filter(
    (thread) => !thread.resolved || comments.showResolved || thread.id === comments.activeId,
  );
  const resolvedCount = comments.threads.length - comments.threads.filter((one) => !one.resolved).length;

  const fail = (error: unknown, message: string): void => toast.pushError(error, message);

  const submitDraft = (body: string): void => {
    if (pageId === null) return;
    const anchor = comments.draft;
    createThread.mutate(
      { pageId, body: { body, ...(anchor === null ? {} : { anchor }) } },
      {
        onSuccess: (data) => {
          comments.cancelDraft();
          comments.focus(data.thread.id);
        },
        onError: (error) => fail(error, 'The comment could not be posted'),
      },
    );
  };

  const askDelete = (comment: Comment, thread: CommentThread): void => {
    const first = thread.comments[0]?.id === comment.id;
    setConfirm({
      title: 'Delete comment',
      danger: true,
      confirmLabel: 'Delete',
      message: first
        ? 'Delete this comment? The whole thread goes with it, replies included.'
        : 'Delete this comment?',
      onConfirm: () => {
        if (pageId === null) return;
        remove.mutate(
          { pageId, commentId: comment.id },
          { onError: (error) => fail(error, 'The comment could not be deleted') },
        );
      },
    });
  };

  return (
    <aside className="comments scroll-y" aria-label="Comments">
      <header className="comments__head">
        <h2 className="comments__title">Comments</h2>
        <span className="comments__count">{comments.unresolved} open</span>
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => comments.setOpen(false)}
          aria-label="Hide the comments"
          title="Hide the comments"
        >
          <Close />
        </button>
      </header>

      {resolvedCount > 0 ? (
        <label className="comments__toggle">
          <input
            type="checkbox"
            checked={comments.showResolved}
            onChange={(event) => comments.setShowResolved(event.target.checked)}
          />
          Show resolved ({resolvedCount})
        </label>
      ) : null}

      {comments.drafting ? null : (
        <button type="button" className="btn comments__new" onClick={() => comments.startDraft(null)}>
          Comment on the page
        </button>
      )}

      {comments.drafting ? (
        <div className="comments__thread comments__thread--draft">
          <div className="comments__quote">
            {comments.draft === null ? (
              <span className="comments__quote-none">On the whole page</span>
            ) : (
              <q className="comments__quote-text">{comments.draft.quote}</q>
            )}
          </div>
          <Composer
            placeholder="Write a comment"
            submitLabel="Comment"
            autoFocus
            busy={busy}
            onCancel={() => comments.cancelDraft()}
            onSubmit={submitDraft}
          />
        </div>
      ) : null}

      {comments.loading ? <p className="empty-note">Loading…</p> : null}

      {!comments.loading && visible.length === 0 && !comments.drafting ? (
        <p className="empty-note">
          No comments yet. Select some text and choose Comment, or comment on the whole page.
        </p>
      ) : null}

      <ul className="comments__list">
        {visible.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            active={thread.id === comments.activeId}
            orphaned={
              thread.anchor !== null && comments.located !== null && !comments.located.has(thread.id)
            }
            busy={busy}
            personFor={personFor}
            canEdit={canEdit}
            canDelete={canDelete}
            onFocus={() => comments.focus(thread.id)}
            onReply={(body) => {
              if (pageId === null) return;
              reply.mutate(
                { pageId, threadId: thread.id, body: { body } },
                { onError: (error) => fail(error, 'The reply could not be posted') },
              );
            }}
            onResolve={(resolved) => {
              if (pageId === null) return;
              resolve.mutate(
                { pageId, threadId: thread.id, resolved },
                { onError: (error) => fail(error, 'The thread could not be updated') },
              );
            }}
            onEdit={(comment, body) => {
              if (pageId === null) return;
              update.mutate(
                { pageId, commentId: comment.id, body: { body } },
                { onError: (error) => fail(error, 'The comment could not be saved') },
              );
            }}
            onDelete={(comment) => askDelete(comment, thread)}
          />
        ))}
      </ul>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </aside>
  );
}

/** The panel in its slot beside the page, drawn only while it is open. */
export function CommentsAside() {
  const comments = useComments();
  if (!comments.open) return null;
  return <CommentsPanel />;
}

export default CommentsPanel;
