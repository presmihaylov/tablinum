import { useRef, useState } from 'react';
import {
  PROPERTY_TYPES,
  type Database,
  type DbProperty,
  type DbView,
  type PropertyType,
} from '@tablinum/shared';
import { Trash } from '../ui/Icon';
import { Pop } from './Pop';

export const TYPE_LABEL: Record<PropertyType, string> = {
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
  person: 'Person',
};

interface PropertyHeadProps {
  property: DbProperty;
  database: Database;
  view: DbView;
  onDatabaseChange: (next: Database) => void;
}

/** One column header, and the menu that renames, retypes, sorts, hides or deletes the column. */
export function PropertyHead({ property, database, view, onDatabaseChange }: PropertyHeadProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(property.name);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const patchProperty = (patch: Partial<DbProperty>): void => {
    onDatabaseChange({
      ...database,
      properties: database.properties.map((entry) =>
        entry.id === property.id ? { ...entry, ...patch } : entry,
      ),
    });
  };

  const patchView = (patch: Partial<DbView>): void => {
    onDatabaseChange({
      ...database,
      views: database.views.map((entry) => (entry.id === view.id ? { ...entry, ...patch } : entry)),
    });
  };

  const sortBy = (direction: 'asc' | 'desc'): void => {
    patchView({ sorts: [{ property: property.id, direction }] });
    setOpen(false);
  };

  const remove = (): void => {
    onDatabaseChange({
      properties: database.properties.filter((entry) => entry.id !== property.id),
      views: database.views.map((entry) => ({
        ...entry,
        filters: entry.filters.filter((filter) => filter.property !== property.id),
        sorts: entry.sorts.filter((sort) => sort.property !== property.id),
        hidden: entry.hidden.filter((id) => id !== property.id),
      })),
    });
    setOpen(false);
  };

  const retype = (type: PropertyType): void => {
    // Options only mean something for the two select types; anything else drops them.
    const options = type === 'select' || type === 'multi_select' ? property.options : [];
    patchProperty({ type, options });
    setOpen(false);
  };

  const commitName = (): void => {
    const next = name.trim();
    if (next.length === 0 || next === property.name) {
      setName(property.name);
      return;
    }
    patchProperty({ name: next });
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
          setName(property.name);
          setOpen((prev) => !prev);
        }}
      >
        {property.name}
        <span className="db-table__kind">{TYPE_LABEL[property.type]}</span>
      </button>
      {open ? (
        <Pop label={`${property.name} column`} anchor={trigger} onClose={() => setOpen(false)}>
          <input
            className="input"
            autoFocus
            aria-label="Property name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commitName();
              setOpen(false);
            }}
          />
          <div className="db-pop__label">Type</div>
          <select
            className="db__select"
            aria-label="Property type"
            value={property.type}
            onChange={(event) => retype(event.target.value as PropertyType)}
          >
            {PROPERTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
          <div className="db-pop__sep" />
          <button type="button" role="menuitem" className="db-pop__item" onClick={() => sortBy('asc')}>
            Sort ascending
          </button>
          <button type="button" role="menuitem" className="db-pop__item" onClick={() => sortBy('desc')}>
            Sort descending
          </button>
          <button
            type="button"
            role="menuitem"
            className="db-pop__item"
            onClick={() => {
              patchView({ hidden: [...view.hidden, property.id] });
              setOpen(false);
            }}
          >
            Hide in this view
          </button>
          <div className="db-pop__sep" />
          <button
            type="button"
            role="menuitem"
            className="db-pop__item db-pop__item--danger"
            onClick={remove}
          >
            <Trash size={12} />
            Delete property
          </button>
        </Pop>
      ) : null}
    </>
  );
}
