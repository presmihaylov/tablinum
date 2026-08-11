import {
  PROPERTY_TYPES,
  withView,
  type Database,
  type DbProperty,
  type DbView,
  type PropertyType,
} from '@tablinum/shared';
import { Trash } from '../ui/Icon';
import { ColumnHead } from './ColumnHead';

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
  /** The page the database is on. A database embedded in another page carries the host's id. */
  pageId: string;
  onDatabaseChange: (next: Database) => void;
}

/** One property column header: the shared menu, plus what only a property offers. */
export function PropertyHead({
  property,
  database,
  view,
  pageId,
  onDatabaseChange,
}: PropertyHeadProps) {
  const patchProperty = (patch: Partial<DbProperty>): void => {
    onDatabaseChange({
      ...database,
      properties: database.properties.map((entry) =>
        entry.id === property.id ? { ...entry, ...patch } : entry,
      ),
    });
  };

  const remove = (): void => {
    onDatabaseChange({
      ...database,
      properties: database.properties.filter((entry) => entry.id !== property.id),
      views: database.views.map((entry) => ({
        ...entry,
        filters: entry.filters.filter((filter) => filter.property !== property.id),
        sorts: entry.sorts.filter((sort) => sort.property !== property.id),
        hidden: entry.hidden.filter((id) => id !== property.id),
      })),
    });
  };

  const retype = (type: PropertyType): void => {
    // Options only mean something for the two select types; anything else drops them.
    const options = type === 'select' || type === 'multi_select' ? property.options : [];
    patchProperty({ type, options });
  };

  return (
    <ColumnHead
      name={property.name}
      kind={TYPE_LABEL[property.type]}
      columnId={property.id}
      pageId={pageId}
      onRename={(name) => patchProperty({ name })}
      onSort={(direction) =>
        onDatabaseChange(withView(database, view.id, { sorts: [{ property: property.id, direction }] }))
      }
    >
      {(close) => (
        <>
          <div className="popmenu__sep" />
          <div className="popmenu__label">Type</div>
          <select
            className="db__select"
            aria-label="Property type"
            value={property.type}
            onChange={(event) => {
              retype(event.target.value as PropertyType);
              close();
            }}
          >
            {PROPERTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
          <button
            type="button"
            role="menuitem"
            className="popmenu__item"
            onClick={() => {
              onDatabaseChange(withView(database, view.id, { hidden: [...view.hidden, property.id] }));
              close();
            }}
          >
            Hide in this view
          </button>
          <div className="popmenu__sep" />
          <button
            type="button"
            role="menuitem"
            className="popmenu__item popmenu__item--danger"
            onClick={() => {
              remove();
              close();
            }}
          >
            <Trash size={12} />
            Delete property
          </button>
        </>
      )}
    </ColumnHead>
  );
}
