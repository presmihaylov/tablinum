import { useState, type DragEvent } from 'react';
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
} from '@tablinum/shared';
import { Plus, Trash } from '../ui/Icon';
import { Tag } from './Cell';
import { Pop } from './Pop';

/** A private type, so a card dragged out of the board is never taken for a page from the tree. */
const DRAG_MIME = 'application/x-tablinum-row';

interface BoardViewProps {
  database: Database;
  view: DbView;
  rows: DbRow[];
  people: Account[];
  onCellChange: (rowId: string, propertyId: string, value: PropValue) => void;
  onCreateRow: (props: RowProps) => void;
  onDeleteRow: (row: DbRow) => void;
  onOpenRow: (row: DbRow) => void;
}

/** The kanban board: one stack of cards for each option of the select property it groups by. */
export function BoardView({
  database,
  view,
  rows,
  people,
  onCellChange,
  onCreateRow,
  onDeleteRow,
  onOpenRow,
}: BoardViewProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const property = boardProperty(database, view);
  const groups = boardGroups(database, view, rows);
  const visible = database.properties.filter(
    (entry) => !view.hidden.includes(entry.id) && entry.id !== property?.id,
  );

  if (property === null) {
    return (
      <p className="db__empty">
        A board stacks its cards by a select column. This database has none yet.
      </p>
    );
  }

  const move = (rowId: string, group: BoardGroup): void => {
    const row = rows.find((entry) => entry.id === rowId);
    if (row === undefined) return;
    if ((row.props[property.id] ?? null) === group.id) return;
    onCellChange(rowId, property.id, group.id);
  };

  const onDrop = (event: DragEvent<HTMLElement>, group: BoardGroup): void => {
    event.preventDefault();
    setOver(null);
    setDragging(null);
    const rowId = event.dataTransfer.getData(DRAG_MIME) || dragging;
    if (rowId) move(rowId, group);
  };

  return (
    <div className="db-board" data-testid="db-board">
      {groups.map((group) => (
        <section
          key={group.id ?? 'none'}
          className={over === (group.id ?? 'none') ? 'db-board__col db-board__col--over' : 'db-board__col'}
          aria-label={group.name}
          data-group={group.id ?? 'none'}
          onDragOver={(event) => {
            // `types` is all a drop target may read while the drag is in flight, and it is
            // enough to tell a card of this board from a page dragged out of the sidebar.
            if (!event.dataTransfer.types.includes(DRAG_MIME) && dragging === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setOver(group.id ?? 'none');
          }}
          onDragLeave={() => setOver((prev) => (prev === (group.id ?? 'none') ? null : prev))}
          onDrop={(event) => onDrop(event, group)}
        >
          <header className="db-board__head">
            <Tag option={{ id: group.id ?? 'none', name: group.name, color: group.color }} />
            <span className="db-board__count">{group.rows.length}</span>
          </header>

          <div className="db-board__cards">
            {group.rows.map((row) => (
              <Card
                key={row.id}
                row={row}
                groups={groups}
                properties={visible}
                people={people}
                dragging={dragging === row.id}
                onDragStart={() => setDragging(row.id)}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onMove={(target) => move(row.id, target)}
                onDelete={() => onDeleteRow(row)}
                onOpen={() => onOpenRow(row)}
              />
            ))}
          </div>

          <button
            type="button"
            className="db-new-row"
            aria-label={`New card in ${group.name}`}
            onClick={() => onCreateRow(group.id === null ? {} : { [property.id]: group.id })}
          >
            <Plus size={12} />
            New
          </button>
        </section>
      ))}
    </div>
  );
}

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
          <Pop label="Card menu" onClose={() => setOpen(false)}>
            <div className="db-pop__label">Move to</div>
            {groups.map((group) => (
              <button
                key={group.id ?? 'none'}
                type="button"
                role="menuitem"
                className="db-pop__item"
                onClick={() => {
                  setOpen(false);
                  onMove(group);
                }}
              >
                {group.name}
              </button>
            ))}
            <div className="db-pop__sep" />
            <button
              type="button"
              role="menuitem"
              className="db-pop__item db-pop__item--danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash size={12} />
              Delete row
            </button>
          </Pop>
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
