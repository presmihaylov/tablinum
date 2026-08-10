import { useEffect, useRef, useState } from 'react';
import type {
  Account,
  Database,
  DbProperty,
  DbRow,
  DbView,
  PropValue,
  SelectOption,
} from '@tablinum/shared';
import { Plus, Trash } from '../ui/Icon';
import { Cell } from './Cell';
import { Pop } from './Pop';
import { PropertyHead } from './PropertyHead';

interface TableViewProps {
  database: Database;
  view: DbView;
  rows: DbRow[];
  people: Account[];
  onDatabaseChange: (next: Database) => void;
  onAddProperty: () => void;
  onCellChange: (rowId: string, propertyId: string, value: PropValue) => void;
  onTitleChange: (rowId: string, title: string) => void;
  onCreateRow: () => void;
  onDeleteRow: (row: DbRow) => void;
  onOpenRow: (row: DbRow) => void;
  onCreateOption: (property: DbProperty, name: string) => Promise<SelectOption | null>;
}

export function TableView({
  database,
  view,
  rows,
  people,
  onDatabaseChange,
  onAddProperty,
  onCellChange,
  onTitleChange,
  onCreateRow,
  onDeleteRow,
  onOpenRow,
  onCreateOption,
}: TableViewProps) {
  const visible = database.properties.filter((property) => !view.hidden.includes(property.id));

  return (
    <div className="db__scroll">
      <table className="db-table" data-testid="db-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="db-table__head">Name</span>
            </th>
            {visible.map((property) => (
              <th key={property.id} scope="col" data-property={property.id}>
                <PropertyHead
                  property={property}
                  database={database}
                  view={view}
                  onDatabaseChange={onDatabaseChange}
                />
              </th>
            ))}
            <th scope="col" className="db-table__add">
              <button
                type="button"
                className="db-table__head"
                aria-label="Add a property"
                onClick={onAddProperty}
              >
                <Plus size={12} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="db-table__row" data-row-id={row.id}>
              <td>
                <TitleCell
                  row={row}
                  onTitleChange={onTitleChange}
                  onDelete={() => onDeleteRow(row)}
                  onOpen={() => onOpenRow(row)}
                />
              </td>
              {visible.map((property) => (
                <td key={property.id} data-property={property.id}>
                  <Cell
                    property={property}
                    value={row.props[property.id] ?? null}
                    people={people}
                    onChange={(value) => onCellChange(row.id, property.id, value)}
                    onCreateOption={onCreateOption}
                  />
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={visible.length + 2}>
              <button type="button" className="db-new-row" onClick={onCreateRow}>
                <Plus size={12} />
                New
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

interface TitleCellProps {
  row: DbRow;
  onTitleChange: (rowId: string, title: string) => void;
  onDelete: () => void;
  onOpen: () => void;
}

function TitleCell({ row, onTitleChange, onDelete, onOpen }: TitleCellProps) {
  const [draft, setDraft] = useState(row.title);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(row.title);
  }, [row.title]);

  const commit = (): void => {
    const next = draft.trim();
    if (next.length === 0 || next === row.title) {
      setDraft(row.title);
      return;
    }
    onTitleChange(row.id, next);
  };

  return (
    <div className="db-title-cell">
      <input
        className="db-cell__input"
        aria-label="Row title"
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <button type="button" className="db-table__open" onClick={onOpen}>
        Open
      </button>
      <button
        ref={trigger}
        type="button"
        className="db-table__open"
        aria-label={`Row menu for ${row.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        ⋯
      </button>
      {open ? (
        <Pop label="Row menu" anchor={trigger} onClose={() => setOpen(false)}>
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
  );
}
