import { useRef, useState, type DragEvent } from 'react';
import {
  boardGroups,
  boardProperty,
  type Account,
  type BoardGroup,
  type Database,
  type DbProperty,
  type DbRow,
  type DbView,
  type PropValue,
  type RowProps,
  type SelectOption,
} from '@tablinum/shared';
import { Plus, Trash } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { Tag } from './Cell';

/** A private type, so a card dragged out of the board is never taken for a page from the tree. */
const DRAG_MIME = 'application/x-tablinum-row';

/** The stack a card is over, and the card it would land in front of. Null means the end. */
interface DropAt {
  group: string | null;
  before: string | null;
}

/** How the board writes a move: the cell it lands in, and where in the file the row goes. */
export interface RowMove {
  props?: RowProps;
  before?: string | null;
}

interface BoardViewProps {
  database: Database;
  view: DbView;
  rows: DbRow[];
  people: Account[];
  onMoveRow: (rowId: string, move: RowMove) => void;
  onCreateRow: (props: RowProps) => void;
  onDeleteRow: (row: DbRow) => void;
  onOpenRow: (row: DbRow) => void;
  onDatabaseChange: (database: Database) => void;
  /** `carry` names rows that land on the option in the same write as the option itself. */
  onCreateOption: (
    property: DbProperty,
    name: string,
    carry?: readonly DbRow[],
  ) => Promise<SelectOption | null>;
}

/** A stack of cards for each option of the select property the view groups by. */
export function BoardView({
  database,
  view,
  rows,
  people,
  onMoveRow,
  onCreateRow,
  onDeleteRow,
  onOpenRow,
  onDatabaseChange,
  onCreateOption,
}: BoardViewProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<DropAt | null>(null);

  const property = boardProperty(database, view);
  const groups = boardGroups(database, view, rows);
  const visible = database.properties.filter(
    (entry) => !view.hidden.includes(entry.id) && entry.id !== property?.id,
  );
  // A sorted view arranges the cards itself, so dropping one between two others would mean
  // nothing. Only an unsorted board keeps the order a hand gives it.
  const byHand = view.sorts.length === 0;

  if (property === null) {
    return (
      <p className="db__empty">
        A board stacks its cards by a select column. This database has none yet.
      </p>
    );
  }

  /** True when the drop would leave the card exactly where it already is. */
  const settled = (rowId: string, at: DropAt): boolean => {
    const target = groups.find((one) => one.id === at.group);
    if (target === undefined) return false;
    const now = target.rows.findIndex((one) => one.id === rowId);
    // A card from another stack always lands somewhere new.
    if (now < 0) return false;
    const to =
      at.before === null ? target.rows.length : target.rows.findIndex((one) => one.id === at.before);
    // Before itself, or before the card that already follows it: both mean it has not moved.
    return to === now || to === now + 1;
  };

  const write = (rowId: string, move: RowMove): void => {
    if (move.props === undefined && move.before === undefined) return;
    onMoveRow(rowId, move);
  };

  const groupOf = (rowId: string): string | null => {
    const row = rows.find((entry) => entry.id === rowId);
    const value = row?.props[property.id] ?? null;
    return typeof value === 'string' ? value : null;
  };

  const drop = (rowId: string, at: DropAt): void => {
    const move: RowMove = {};
    if (groupOf(rowId) !== at.group) move.props = { [property.id]: at.group };
    if (byHand && !settled(rowId, at)) move.before = at.before;
    write(rowId, move);
  };

  /** The menu moves a card between stacks, and never says anything about the order. */
  const pick = (rowId: string, group: BoardGroup): void => {
    if (groupOf(rowId) === group.id) return;
    write(rowId, { props: { [property.id]: group.id } });
  };

  const renameOption = (optionId: string, name: string): void => {
    onDatabaseChange({
      ...database,
      properties: database.properties.map((entry) =>
        entry.id !== property.id
          ? entry
          : {
              ...entry,
              options: entry.options.map((one) => (one.id === optionId ? { ...one, name } : one)),
            },
      ),
    });
  };

  /**
   * Give a stack a name. A named stack keeps its option and renames it. The stack that holds
   * none earns one, and its cards land on that option in the same write.
   */
  const renameGroup = (group: BoardGroup, name: string): void => {
    if (group.id !== null) {
      renameOption(group.id, name);
      return;
    }
    void onCreateOption(property, name, group.rows);
  };

  /** Take a stack off the board. The cards it held keep their place and lose their option. */
  const removeOption = (optionId: string): void => {
    onDatabaseChange({
      ...database,
      properties: database.properties.map((entry) =>
        entry.id !== property.id
          ? entry
          : { ...entry, options: entry.options.filter((one) => one.id !== optionId) },
      ),
    });
  };

  return (
    <div className="db-board" data-testid="db-board">
      {groups.map((group) => (
        <Column
          key={group.id ?? 'none'}
          group={group}
          groups={groups}
          properties={visible}
          people={people}
          dragging={dragging}
          byHand={byHand}
          over={over?.group === group.id ? over : null}
          onOver={setOver}
          onLeave={() => setOver((prev) => (prev?.group === group.id ? null : prev))}
          onDrop={drop}
          onPick={pick}
          onDragStart={setDragging}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          onCreateRow={() => onCreateRow(group.id === null ? {} : { [property.id]: group.id })}
          onDeleteRow={onDeleteRow}
          onOpenRow={onOpenRow}
          onRename={(name) => renameGroup(group, name)}
          onRemove={removeOption}
        />
      ))}

      <AddGroup onAdd={(name) => onCreateOption(property, name)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// one stack
// ---------------------------------------------------------------------------

interface ColumnProps {
  group: BoardGroup;
  groups: BoardGroup[];
  properties: DbProperty[];
  people: Account[];
  dragging: string | null;
  byHand: boolean;
  over: DropAt | null;
  onOver: (at: DropAt) => void;
  onLeave: () => void;
  onDrop: (rowId: string, at: DropAt) => void;
  onPick: (rowId: string, group: BoardGroup) => void;
  onDragStart: (rowId: string) => void;
  onDragEnd: () => void;
  onCreateRow: () => void;
  onDeleteRow: (row: DbRow) => void;
  onOpenRow: (row: DbRow) => void;
  onRename: (name: string) => void;
  onRemove: (optionId: string) => void;
}

function Column({
  group,
  groups,
  properties,
  people,
  dragging,
  byHand,
  over,
  onOver,
  onLeave,
  onDrop,
  onPick,
  onDragStart,
  onDragEnd,
  onCreateRow,
  onDeleteRow,
  onOpenRow,
  onRename,
  onRemove,
}: ColumnProps) {
  const id = group.id ?? 'none';
  // Bound here rather than read inside the callback, so its null check narrows the type.
  const optionId = group.id;

  /** True while a card of this board is in the air. `types` is all a drop target may read. */
  const carrying = (event: DragEvent<HTMLElement>): boolean =>
    event.dataTransfer.types.includes(DRAG_MIME) || dragging !== null;

  const take = (event: DragEvent<HTMLElement>, before: string | null): void => {
    if (!carrying(event)) return;
    event.preventDefault();
    // The stack under the cards is a target of its own, and it must not answer for a card.
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    onOver({ group: group.id, before: byHand ? before : null });
  };

  const land = (event: DragEvent<HTMLElement>, before: string | null): void => {
    event.preventDefault();
    event.stopPropagation();
    const rowId = event.dataTransfer.getData(DRAG_MIME) || dragging;
    onDragEnd();
    if (rowId) onDrop(rowId, { group: group.id, before: byHand ? before : null });
  };

  /** The card the pointer sits above: its own top half, or the top of the one after it. */
  const nearest = (event: DragEvent<HTMLElement>, row: DbRow, index: number): string | null => {
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientY < box.top + box.height / 2) return row.id;
    return group.rows[index + 1]?.id ?? null;
  };

  return (
    <section
      className={over === null ? 'db-board__col' : 'db-board__col db-board__col--over'}
      aria-label={group.name}
      data-group={id}
      onDragOver={(event) => take(event, null)}
      onDragLeave={onLeave}
      onDrop={(event) => land(event, null)}
    >
      <header className="db-board__head">
        <GroupMenu
          group={group}
          onRename={onRename}
          onRemove={optionId === null ? null : () => onRemove(optionId)}
        />
        <span className="db-board__count">{group.rows.length}</span>
      </header>

      <div className="db-board__cards">
        {group.rows.map((row, index) => (
          <div
            key={row.id}
            className="db-board__slot"
            onDragOver={(event) => take(event, nearest(event, row, index))}
            onDrop={(event) => land(event, nearest(event, row, index))}
          >
            {over?.before === row.id ? <div className="db-board__line" /> : null}
            <Card
              row={row}
              groups={groups}
              properties={properties}
              people={people}
              dragging={dragging === row.id}
              onDragStart={() => onDragStart(row.id)}
              onDragEnd={onDragEnd}
              onMove={(target) => onPick(row.id, target)}
              onDelete={() => onDeleteRow(row)}
              onOpen={() => onOpenRow(row)}
            />
          </div>
        ))}
        {over !== null && over.before === null && dragging !== null ? (
          <div className="db-board__line" />
        ) : null}
      </div>

      <button
        type="button"
        className="db-new-row"
        aria-label={`New card in ${group.name}`}
        onClick={onCreateRow}
      >
        <Plus size={12} />
        New
      </button>
    </section>
  );
}

interface GroupMenuProps {
  group: BoardGroup;
  onRename: (name: string) => void;
  /** Null on the stack that holds no option, which has none to take away. */
  onRemove: (() => void) | null;
}

/** The head of a stack. It opens the menu that renames the stack or takes it off the board. */
function GroupMenu({ group, onRename, onRemove }: GroupMenuProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const close = (): void => {
    setOpen(false);
    setName(group.name);
  };

  const commit = (): void => {
    const next = name.trim();
    if (next.length === 0 || next === group.name) {
      setName(group.name);
      return;
    }
    onRename(next);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="db-board__group"
        aria-label={`Stack menu for ${group.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Tag option={group} />
      </button>
      {open ? (
        <Menu label={`Stack ${group.name}`} anchor={trigger} onClose={close}>
          <input
            className="input"
            autoFocus
            aria-label="Stack name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commit();
              close();
            }}
          />
          {onRemove === null ? null : (
            <>
              <div className="popmenu__sep" />
              <button
                type="button"
                role="menuitem"
                className="popmenu__item popmenu__item--danger"
                onClick={() => {
                  setOpen(false);
                  onRemove();
                }}
              >
                <Trash size={12} />
                Delete stack
              </button>
            </>
          )}
        </Menu>
      ) : null}
    </>
  );
}

/** The column at the right end that adds an option, which is a stack of its own. */
function AddGroup({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const commit = (): void => {
    const next = name.trim();
    setName('');
    setOpen(false);
    if (next.length > 0) onAdd(next);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="db-board__add"
        aria-label="Add a stack"
        onClick={() => setOpen(true)}
      >
        <Plus size={12} />
        Add a stack
      </button>
    );
  }

  return (
    <div className="db-board__add db-board__add--open">
      <input
        className="input"
        autoFocus
        aria-label="New stack name"
        placeholder="In review"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            setName('');
            setOpen(false);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// one card
// ---------------------------------------------------------------------------

interface CardProps {
  row: DbRow;
  groups: BoardGroup[];
  properties: DbProperty[];
  people: Account[];
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (group: BoardGroup) => void;
  onDelete: () => void;
  onOpen: () => void;
}

function Card({
  row,
  groups,
  properties,
  people,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onDelete,
  onOpen,
}: CardProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const filled = properties.filter((property) => (row.props[property.id] ?? null) !== null);

  return (
    <article
      className={dragging ? 'db-card db-card--dragging' : 'db-card'}
      data-row-id={row.id}
      aria-label={row.title}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, row.id);
        event.dataTransfer.setData('text/plain', row.title);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="db-card__top">
        <button type="button" className="db-card__title" onClick={onOpen}>
          {row.title}
        </button>
        <button
          ref={trigger}
          type="button"
          className="db-card__menu"
          aria-label={`Card menu for ${row.title}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          ⋯
        </button>
        {open ? (
          <Menu label="Card menu" anchor={trigger} onClose={() => setOpen(false)}>
            <div className="popmenu__label">Move to</div>
            {groups.map((group) => (
              <button
                key={group.id ?? 'none'}
                type="button"
                role="menuitem"
                className="popmenu__item"
                onClick={() => {
                  setOpen(false);
                  onMove(group);
                }}
              >
                {group.name}
              </button>
            ))}
            <div className="popmenu__sep" />
            <button
              type="button"
              role="menuitem"
              className="popmenu__item popmenu__item--danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash size={12} />
              Delete row
            </button>
          </Menu>
        ) : null}
      </div>

      {filled.map((property) => (
        <div className="db-card__prop" key={property.id} data-property={property.id}>
          <CardValue property={property} value={row.props[property.id] ?? null} people={people} />
        </div>
      ))}
    </article>
  );
}

interface CardValueProps {
  property: DbProperty;
  value: PropValue;
  people: Account[];
}

/** A card shows its values, it does not edit them: the row page and the table do that. */
function CardValue({ property, value, people }: CardValueProps) {
  if (value === null) return null;

  if (property.type === 'select' || property.type === 'multi_select') {
    const ids = Array.isArray(value) ? value : [value];
    return (
      <>
        {property.options
          .filter((option) => ids.includes(option.id))
          .map((option) => (
            <Tag key={option.id} option={option} />
          ))}
      </>
    );
  }

  if (property.type === 'checkbox') {
    return <span className="db-card__text">{value === true ? `✓ ${property.name}` : ''}</span>;
  }

  if (property.type === 'person') {
    const ids = Array.isArray(value) ? value : [];
    const names = ids.map(
      (id) => people.find((account) => account.id === id)?.name ?? 'Someone who left',
    );
    return <span className="db-card__text">{names.join(', ')}</span>;
  }

  return <span className="db-card__text">{Array.isArray(value) ? value.join(', ') : String(value)}</span>;
}
