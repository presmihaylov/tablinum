import { useRef, useState, type ReactNode } from 'react';
import { threadsForColumn, unresolvedCount } from '@tablinum/shared';
import { useComments } from '../../lib/comments';
import { Bubble } from '../ui/Icon';
import { Menu } from '../ui/Menu';

interface ColumnHeadProps {
  /** What the column is called. The header shows it and the rename box starts from it. */
  name: string;
  /** What the column is, drawn beside the name: the type of a property, or "Title". */
  kind: string;
  /** The id a comment on this column carries. */
  columnId: string;
  /** The page the database is on. A database embedded in another page carries the host's id. */
  pageId: string;
  onRename: (name: string) => void;
  onSort: (direction: 'asc' | 'desc') => void;
  /** The menu items only this kind of column offers, at the foot of the menu. */
  children?: (close: () => void) => ReactNode;
}

/**
 * One column header: the button that opens it, the comment badge beside it, and the menu that
 * renames the column, sorts by it or starts a conversation about it. Every column has those,
 * whether it is a property or the title the rows are named by, so both kinds are drawn here and
 * each adds only what it alone offers.
 */
export function ColumnHead({
  name,
  kind,
  columnId,
  pageId,
  onRename,
  onSort,
  children,
}: ColumnHeadProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const comments = useComments();

  // An embedded database belongs to another page, and the panel here is the host page's. Only the
  // grid on its own page may talk to it.
  const ownPage = comments.pageId === pageId;
  const mine = ownPage ? threadsForColumn(comments.threads, columnId) : [];
  const openCount = unresolvedCount(mine);

  const close = (): void => setOpen(false);

  const commitName = (): void => {
    const next = draft.trim();
    if (next.length === 0 || next === name) {
      setDraft(name);
      return;
    }
    onRename(next);
  };

  const sortBy = (direction: 'asc' | 'desc'): void => {
    onSort(direction);
    close();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="db-table__head"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setDraft(name);
          setOpen((prev) => !prev);
        }}
      >
        {name}
        <span className="db-table__kind">{kind}</span>
      </button>
      {mine.length > 0 ? (
        <button
          type="button"
          className={openCount > 0 ? 'db-table__note' : 'db-table__note is-quiet'}
          aria-label={`Comments on ${name}, ${openCount} open`}
          title={`Comments on ${name}, ${openCount} open`}
          onClick={() => {
            const first = mine.find((thread) => !thread.resolved) ?? mine[0];
            if (first !== undefined) comments.focus(first.id);
          }}
        >
          <Bubble size={11} />
          {openCount > 0 ? openCount : null}
        </button>
      ) : null}
      {open ? (
        <Menu label={`${name} column`} anchor={trigger} onClose={close}>
          <input
            className="input"
            autoFocus
            aria-label="Column name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commitName();
              close();
            }}
          />
          <div className="popmenu__sep" />
          <button type="button" role="menuitem" className="popmenu__item" onClick={() => sortBy('asc')}>
            Sort ascending
          </button>
          <button type="button" role="menuitem" className="popmenu__item" onClick={() => sortBy('desc')}>
            Sort descending
          </button>
          {ownPage ? (
            <button
              type="button"
              role="menuitem"
              className="popmenu__item"
              onClick={() => {
                comments.startDraft({ anchor: null, column: columnId });
                close();
              }}
            >
              <Bubble size={12} />
              Comment on this column
            </button>
          ) : null}
          {children?.(close)}
        </Menu>
      ) : null}
    </>
  );
}
