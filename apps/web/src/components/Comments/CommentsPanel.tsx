import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { Account, Agent, Comment, CommentAnchor, CommentThread } from '@tablinum/shared';
import {
  useAgents,
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
import { MenuList } from '../ui/MenuList';
import { PersonRow, type MentionCandidate } from '../ui/PersonRow';
import { renderCommentBody } from './render';
import {
  applyMention,
  matchPeople,
  mentionSpot,
  peopleToMention,
  type MentionSpot,
} from './mention';
import { fieldHeight, groupByAnchor, stackGroups, type CardGroup } from './layout';
import './comments.css';

/** Somebody who has left the workspace still owns their remarks; only their name is gone. */
const GONE: Omit<AvatarPerson, 'id'> = { name: 'A former member', color: 'var(--text-faint)' };

/** The key the draft carries in the field, matching the id its highlight is drawn under. */
const DRAFT_KEY = 'draft';

/** Everyone who can author a remark here, people and agents together, by id. */
function writersById(users: Account[], agents: Agent[]): Map<string, AvatarPerson> {
  const all = new Map<string, AvatarPerson>();
  for (const writer of [...users, ...agents]) {
    all.set(writer.id, {
      id: writer.id,
      name: writer.name,
      color: writer.color,
      avatarRev: writer.avatarRev,
    });
  }
  return all;
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  busy: boolean;
  /** Who can be named with an `@`. */
  people: MentionCandidate[];
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

function Composer({
  placeholder,
  submitLabel,
  initial = '',
  autoFocus = false,
  busy,
  people,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const [value, setValue] = useState(initial);
  const [spot, setSpot] = useState<MentionSpot | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Set when a pick rewrites the body: the caret has to move after React paints the new value.
  const caretWanted = useRef<number | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(() => {
    const at = caretWanted.current;
    if (at === null) return;
    caretWanted.current = null;
    ref.current?.focus();
    ref.current?.setSelectionRange(at, at);
  });

  const choices = spot === null ? [] : matchPeople(people, spot.query);
  const menuOpen = spot !== null && choices.length > 0;

  const look = (text: string, caret: number | null): void => {
    setSpot(caret === null ? null : mentionSpot(text, caret));
    setActive(0);
  };

  const pick = (person: MentionCandidate): void => {
    if (spot === null) return;
    const next = applyMention(value, spot, person.handle);
    setValue(next.text);
    setSpot(null);
    caretWanted.current = next.caret;
  };

  const submit = (): void => {
    const body = value.trim();
    if (body.length === 0) return;
    onSubmit(body);
    setValue('');
    setSpot(null);
  };

  /** The menu owns these keys while it is open, so Escape closes it before the composer. */
  const menuKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!menuOpen) return false;
    if (event.key === 'Escape') {
      setSpot(null);
      return true;
    }
    if (event.key === 'ArrowDown') {
      setActive((current) => (current + 1) % choices.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      setActive((current) => (current + choices.length - 1) % choices.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const person = choices[active];
      if (person !== undefined) pick(person);
      return true;
    }
    return false;
  };

  return (
    <div className="comments__composer">
      <div className="comments__field-box">
        <textarea
          ref={ref}
          className="input comments__input"
          rows={3}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => {
            setValue(event.target.value);
            look(event.target.value, event.target.selectionStart);
          }}
          onClick={(event) => look(event.currentTarget.value, event.currentTarget.selectionStart)}
          onBlur={() => setSpot(null)}
          onKeyDown={(event) => {
            if (menuKey(event)) {
              event.preventDefault();
              return;
            }
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

        {menuOpen ? (
          <MenuList
            className="comments__mentions"
            items={choices}
            active={active}
            label="Mention somebody"
            keyOf={(person) => person.id}
            renderRow={(person) => <PersonRow person={person} />}
            onHover={setActive}
            onPick={pick}
          />
        ) : null}
      </div>

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
  people: MentionCandidate[];
  /** The reader's handle, so a mention of them stands out. */
  me: string | null;
  /** A closed card shows the remark cut short and offers nothing to do with it. */
  preview?: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
}

function CommentRow({
  comment,
  person,
  canEdit,
  canDelete,
  busy,
  people,
  me,
  preview = false,
  onEdit,
  onDelete,
}: CommentRowProps) {
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
            people={people}
            onCancel={() => setEditing(false)}
            onSubmit={(body) => {
              setEditing(false);
              onEdit(body);
            }}
          />
        ) : (
          <div
            className={preview ? 'comment__text comment__text--preview' : 'comment__text'}
            // Rendered by a markdown-it with raw HTML turned off; see render.ts.
            dangerouslySetInnerHTML={{ __html: renderCommentBody(comment.body, me) }}
          />
        )}

        {editing || preview ? null : (
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
  people: MentionCandidate[];
  me: string | null;
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
  people,
  me,
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
  // The thread in focus is the open one. Every other card shows only as much as it takes to
  // recognise the remark, so a page full of comments can be read at a glance.
  const open = active;
  const shown = open ? thread.comments : thread.comments.slice(0, 1);
  const rest = thread.comments.length - shown.length;

  const classes = ['comments__thread'];
  if (active) classes.push('comments__thread--active');
  if (!open) classes.push('comments__thread--peek');
  if (thread.resolved) classes.push('comments__thread--resolved');

  return (
    <li
      className={classes.join(' ')}
      data-thread-id={thread.id}
      // A card takes the focus from the keyboard too, and opens on the way in.
      tabIndex={open ? -1 : 0}
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
        {shown.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            person={personFor(comment.author)}
            canEdit={canEdit(comment)}
            canDelete={canDelete(comment)}
            busy={busy}
            people={people}
            me={me}
            preview={!open}
            onEdit={(body) => onEdit(comment, body)}
            onDelete={() => onDelete(comment)}
          />
        ))}
      </ul>

      {rest > 0 ? <p className="comments__rest">{replyCount(rest)}</p> : null}

      {!open ? null : replying ? (
        <Composer
          placeholder="Reply"
          submitLabel="Reply"
          autoFocus
          busy={busy}
          people={people}
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
            // The card puts itself in focus on any click, which would keep a resolved thread here.
            onClick={(event) => {
              event.stopPropagation();
              onResolve(!thread.resolved);
            }}
          >
            {thread.resolved ? 'Reopen' : <><Check size={12} /> Resolve</>}
          </button>
        </div>
      )}
    </li>
  );
}

function replyCount(rest: number): string {
  return rest === 1 ? '1 more reply' : `${rest} more replies`;
}

interface DraftCardProps {
  anchor: CommentAnchor | null;
  busy: boolean;
  people: MentionCandidate[];
  onCancel: () => void;
  onSubmit: (body: string) => void;
}

/** The card of a thread that is being written. It sits at the selection it is about. */
function DraftCard({ anchor, busy, people, onCancel, onSubmit }: DraftCardProps) {
  return (
    <li className="comments__thread comments__thread--draft">
      <div className="comments__quote">
        {anchor === null ? (
          <span className="comments__quote-none">On the whole page</span>
        ) : (
          <q className="comments__quote-text">{anchor.quote}</q>
        )}
      </div>
      <Composer
        placeholder="Write a comment"
        submitLabel="Comment"
        autoFocus
        busy={busy}
        people={people}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </li>
  );
}

interface FieldState {
  groups: CardGroup[];
  /** Where each group sits, keyed by the id of the thread that heads it. */
  tops: Record<string, number>;
  height: number;
}

const EMPTY_FIELD: FieldState = { groups: [], tops: {}, height: 0 };

/** Where the words a card marks start, measured from the top of the field. */
function anchorTop(id: string, base: number): number {
  const mark = document.querySelector(`[data-comment-anchor="${id}"]`);
  if (!(mark instanceof HTMLElement)) return 0;
  return mark.getBoundingClientRect().top - base;
}

/**
 * Puts every card level with the words it marks.
 *
 * The measurements are taken from the page itself after each render, so nothing has to be told
 * when a line wraps, an image loads or somebody types. Two passes are enough: the first reads
 * the anchors and groups them, the second reads the heights the grouping produced.
 */
function useField(ids: string[], priorityId: string | null) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const [field, setField] = useState<FieldState>(EMPTY_FIELD);

  const registerGroup = useCallback(
    (key: string) => (node: HTMLElement | null) => {
      if (node === null) boxes.current.delete(key);
      else boxes.current.set(key, node);
    },
    [],
  );

  useLayoutEffect(() => {
    const box = fieldRef.current;
    if (box === null) return;

    const base = box.getBoundingClientRect().top;
    const groups = groupByAnchor(ids.map((id) => ({ id, desired: anchorTop(id, base) })));
    const items = groups.map((group) => {
      const key = group.ids[0] ?? '';
      return { key, desired: group.desired, height: boxes.current.get(key)?.offsetHeight ?? 0 };
    });
    // A card in focus keeps its place; its whole group does, since they share one box.
    const priority = groups.find((group) => group.ids.includes(priorityId ?? ''))?.ids[0] ?? null;
    const placed = stackGroups(items, priority);

    const next: FieldState = {
      groups,
      tops: Object.fromEntries(placed.map((one) => [one.key, one.top])),
      height: fieldHeight(items, placed),
    };
    setField((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  return { field, fieldRef, registerGroup };
}

/** The side panel: every thread on the open page, newest business at the bottom of each. */
export function CommentsPanel() {
  const comments = useComments();
  const { user } = useAuth();
  const users = useUsers();
  // An agent authors a remark under its own name, so its picture has to be here too.
  const agents = useAgents();
  const toast = useToast();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const createThread = useCreateThread();
  const reply = useReplyToThread();
  const resolve = useResolveThread();
  const update = useUpdateComment();
  const remove = useDeleteComment();

  const roster = useMemo(
    () => writersById(users.data?.users ?? [], agents.data?.agents ?? []),
    [users.data, agents.data],
  );
  const mentionable = useMemo(() => peopleToMention(users.data?.users ?? []), [users.data]);
  const pageId = comments.pageId;

  const busy =
    createThread.isPending ||
    reply.isPending ||
    resolve.isPending ||
    update.isPending ||
    remove.isPending;

  const personFor = (writerId: string): AvatarPerson =>
    roster.get(writerId) ?? { id: writerId, ...GONE };

  const isAdmin = user?.role === 'admin';
  const canEdit = (comment: Comment): boolean => comment.author === user?.id;
  // An admin can take a remark down, but nobody may reword somebody else's.
  const canDelete = (comment: Comment): boolean => canEdit(comment) || isAdmin;

  const visible = comments.threads.filter(
    (thread) => !thread.resolved || comments.showResolved || thread.id === comments.activeId,
  );
  const resolvedCount = comments.threads.length - comments.threads.filter((one) => !one.resolved).length;

  // A thread whose words are still on the page is drawn beside them. One about the whole page,
  // and one whose words are gone, have nowhere to point, so they stay at the top of the panel.
  const orphaned = (thread: CommentThread): boolean =>
    thread.anchor !== null && comments.located !== null && !comments.located.has(thread.id);
  const anchored = visible.filter((thread) => thread.anchor !== null && !orphaned(thread));
  const loose = visible.filter((thread) => !anchored.includes(thread));

  const draftAnchored = comments.drafting && comments.draft !== null;
  const ids = [...anchored.map((thread) => thread.id), ...(draftAnchored ? [DRAFT_KEY] : [])];
  // The draft is the thing being written, so it holds its place and everything else moves.
  const { field, fieldRef, registerGroup } = useField(
    ids,
    draftAnchored ? DRAFT_KEY : comments.activeId,
  );
  const byId = new Map(visible.map((thread) => [thread.id, thread]));

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

  const card = (thread: CommentThread | undefined): ReactNode => {
    if (thread === undefined) return null;
    return (
      <ThreadCard
        key={thread.id}
        thread={thread}
        active={thread.id === comments.activeId}
        orphaned={orphaned(thread)}
        busy={busy}
        people={mentionable}
        me={user?.handle ?? null}
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
          // A thread in focus stays in the list even when resolved, so the focus goes first.
          if (resolved) comments.focus(null);
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
    <aside className="comments" aria-label="Comments">
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

      {comments.drafting && !draftAnchored ? (
        <ul className="comments__list">
          <DraftCard
            anchor={null}
            busy={busy}
            people={mentionable}
            onCancel={() => comments.cancelDraft()}
            onSubmit={submitDraft}
          />
        </ul>
      ) : null}

      {comments.loading ? <p className="empty-note">Loading…</p> : null}

      {!comments.loading && visible.length === 0 && !comments.drafting ? (
        <p className="empty-note">
          No comments yet. Select some text and choose Comment, or comment on the whole page.
        </p>
      ) : null}

      {loose.length > 0 ? <ul className="comments__list">{loose.map(card)}</ul> : null}

      <div className="comments__field" ref={fieldRef} style={{ height: field.height }}>
        {field.groups.map((group) => {
          const key = group.ids[0] ?? '';
          const classes = ['comments__group'];
          // Threads about the same spot are read together, and say so with one shared rail.
          if (group.ids.length > 1) classes.push('comments__group--many');
          return (
            <ul
              key={key}
              className={classes.join(' ')}
              ref={registerGroup(key)}
              style={{ transform: `translateY(${field.tops[key] ?? 0}px)` }}
            >
              {group.ids.map((id) =>
                id === DRAFT_KEY ? (
                  <DraftCard
                    key={DRAFT_KEY}
                    anchor={comments.draft}
                    busy={busy}
                    people={mentionable}
                    onCancel={() => comments.cancelDraft()}
                    onSubmit={submitDraft}
                  />
                ) : (
                  card(byId.get(id))
                ),
              )}
            </ul>
          );
        })}
      </div>

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
