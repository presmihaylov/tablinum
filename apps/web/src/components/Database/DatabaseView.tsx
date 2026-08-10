import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_VIEW_NAME,
  OPS_FOR_TYPE,
  applyView,
  newPropertyId,
  newOptionId,
  newViewId,
  opTakesNoValue,
  type Database,
  type DbFilter,
  type DbProperty,
  type DbRow,
  type DbView,
  type FilterOp,
  type Page,
  type PropValue,
  type SelectOption,
} from '@tablinum/shared';
import {
  useCreateRow,
  useDatabase,
  useDeletePage,
  useSetDatabase,
  useUpdateRow,
  useUsers,
} from '../../api/hooks';
import { useToast } from '../../lib/toast';
import { Plus } from '../ui/Icon';
import { nextOptionColor } from './Cell';
import { TableView } from './TableView';
import { TYPE_LABEL } from './PropertyHead';
import './database.css';

type Panel = 'filter' | 'sort' | 'properties' | null;

const OP_LABEL: Record<FilterOp, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  does_not_contain: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: 'is greater than',
  lt: 'is less than',
  before: 'is before',
  after: 'is after',
};

/** A name no other property in the database already uses. */
function freePropertyName(database: Database): string {
  const taken = new Set(database.properties.map((property) => property.name));
  if (!taken.has('Property')) return 'Property';
  for (let n = 2; ; n += 1) {
    const candidate = `Property ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

interface DatabaseViewProps {
  page: Page;
}

/** The database on a page: its view tabs, its tools and its grid. */
export function DatabaseView({ page }: DatabaseViewProps) {
  const toast = useToast();
  const query = useDatabase(page.id);
  const users = useUsers();
  const setDatabase = useSetDatabase();
  const createRow = useCreateRow();
  const updateRow = useUpdateRow();
  const deletePage = useDeletePage();

  const [viewId, setViewId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const database = query.data?.database ?? page.database ?? null;
  const rows = useMemo<DbRow[]>(() => query.data?.rows ?? [], [query.data]);
  const people = users.data?.users ?? [];

  const view = useMemo<DbView | null>(() => {
    if (database === null) return null;
    return database.views.find((entry) => entry.id === viewId) ?? database.views[0] ?? null;
  }, [database, viewId]);

  const shown = useMemo<DbRow[]>(() => {
    if (database === null || view === null) return rows;
    return applyView(database, view, rows);
  }, [database, view, rows]);

  if (database === null || view === null) return null;

  const save = (next: Database): void => {
    setDatabase.mutate(
      { pageId: page.id, database: next },
      { onError: (error) => toast.pushError(error, 'The database could not be saved') },
    );
  };

  const patchView = (patch: Partial<DbView>): void => {
    save({
      ...database,
      views: database.views.map((entry) => (entry.id === view.id ? { ...entry, ...patch } : entry)),
    });
  };

  const addProperty = (): void => {
    const property: DbProperty = {
      id: newPropertyId(),
      name: freePropertyName(database),
      type: 'text',
      options: [],
    };
    save({ ...database, properties: [...database.properties, property] });
  };

  const addView = (): void => {
    const name = `${DEFAULT_VIEW_NAME} ${database.views.length + 1}`;
    const next: DbView = {
      id: newViewId(),
      name,
      type: 'table',
      filters: [],
      sorts: [],
      hidden: [],
    };
    setViewId(next.id);
    save({ ...database, views: [...database.views, next] });
  };

  const createOption = async (
    property: DbProperty,
    name: string,
  ): Promise<SelectOption | null> => {
    const option: SelectOption = {
      id: newOptionId(),
      name,
      color: nextOptionColor(property.options),
    };
    try {
      await setDatabase.mutateAsync({
        pageId: page.id,
        database: {
          ...database,
          properties: database.properties.map((entry) =>
            entry.id === property.id ? { ...entry, options: [...entry.options, option] } : entry,
          ),
        },
      });
      return option;
    } catch (error) {
      toast.pushError(error, 'The option could not be added');
      return null;
    }
  };

  const changeCell = (rowId: string, propertyId: string, value: PropValue): void => {
    updateRow.mutate(
      { pageId: page.id, rowId, body: { props: { [propertyId]: value } } },
      { onError: (error) => toast.pushError(error, 'The cell could not be saved') },
    );
  };

  const changeTitle = (rowId: string, title: string): void => {
    updateRow.mutate(
      { pageId: page.id, rowId, body: { title } },
      { onError: (error) => toast.pushError(error, 'The row could not be renamed') },
    );
  };

  const addRow = (): void => {
    createRow.mutate(
      { pageId: page.id, body: {} },
      { onError: (error) => toast.pushError(error, 'The row could not be created') },
    );
  };

  const removeRow = (row: DbRow): void => {
    deletePage.mutate(
      { id: row.id },
      { onError: (error) => toast.pushError(error, 'The row could not be deleted') },
    );
  };

  const togglePanel = (next: Exclude<Panel, null>): void =>
    setPanel((prev) => (prev === next ? null : next));

  return (
    <section className="db" aria-label="Database">
      <div className="db__bar">
        <div className="db__views" role="tablist" aria-label="Database views">
          {database.views.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              className="db__view"
              aria-selected={entry.id === view.id}
              onClick={() => setViewId(entry.id)}
            >
              {entry.name}
            </button>
          ))}
          <button type="button" className="db__view" aria-label="Add a view" onClick={addView}>
            <Plus size={12} />
          </button>
        </div>

        <div className="db__tools">
          <button
            type="button"
            className={panel === 'filter' ? 'db__tool db__tool--on' : 'db__tool'}
            aria-expanded={panel === 'filter'}
            onClick={() => togglePanel('filter')}
          >
            Filter{view.filters.length > 0 ? ` (${view.filters.length})` : ''}
          </button>
          <button
            type="button"
            className={panel === 'sort' ? 'db__tool db__tool--on' : 'db__tool'}
            aria-expanded={panel === 'sort'}
            onClick={() => togglePanel('sort')}
          >
            Sort{view.sorts.length > 0 ? ` (${view.sorts.length})` : ''}
          </button>
          <button
            type="button"
            className={panel === 'properties' ? 'db__tool db__tool--on' : 'db__tool'}
            aria-expanded={panel === 'properties'}
            onClick={() => togglePanel('properties')}
          >
            Properties
          </button>
          <button type="button" className="btn btn--primary" onClick={addRow}>
            New
          </button>
        </div>
      </div>

      {panel === 'filter' ? (
        <FilterPanel database={database} view={view} onChange={patchView} />
      ) : null}
      {panel === 'sort' ? <SortPanel database={database} view={view} onChange={patchView} /> : null}
      {panel === 'properties' ? (
        <PropertiesPanel
          database={database}
          view={view}
          onChange={patchView}
          onAddProperty={addProperty}
        />
      ) : null}

      <TableView
        database={database}
        view={view}
        rows={shown}
        people={people}
        onDatabaseChange={save}
        onAddProperty={addProperty}
        onCellChange={changeCell}
        onTitleChange={changeTitle}
        onCreateRow={addRow}
        onDeleteRow={removeRow}
        onCreateOption={createOption}
      />

      {rows.length === 0 ? <p className="db__empty">This database has no rows yet.</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// panels
// ---------------------------------------------------------------------------

interface PanelProps {
  database: Database;
  view: DbView;
  onChange: (patch: Partial<DbView>) => void;
}

function FilterPanel({ database, view, onChange }: PanelProps) {
  const first = database.properties[0];

  const patchFilter = (index: number, patch: Partial<DbFilter>): void => {
    onChange({
      filters: view.filters.map((filter, at) => (at === index ? { ...filter, ...patch } : filter)),
    });
  };

  return (
    <div className="db__panel" aria-label="Filters">
      {view.filters.map((filter, index) => {
        const property =
          database.properties.find((entry) => entry.id === filter.property) ?? first ?? null;
        if (property === null) return null;
        const ops = OPS_FOR_TYPE[property.type];
        return (
          <div className="db__panel-row" key={`${filter.property}-${index}`}>
            <select
              className="db__select"
              aria-label="Filter property"
              value={filter.property}
              onChange={(event) => {
                const next = database.properties.find((entry) => entry.id === event.target.value);
                if (next === undefined) return;
                // The old operator may not exist for the new type, so fall back to its first.
                patchFilter(index, {
                  property: next.id,
                  op: OPS_FOR_TYPE[next.type][0] ?? 'is',
                  value: null,
                });
              }}
            >
              {database.properties.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <select
              className="db__select"
              aria-label="Filter operator"
              value={filter.op}
              onChange={(event) => patchFilter(index, { op: event.target.value as FilterOp })}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op]}
                </option>
              ))}
            </select>
            {opTakesNoValue(filter.op) ? null : (
              <FilterValue
                property={property}
                value={filter.value}
                onChange={(value) => patchFilter(index, { value })}
              />
            )}
            <button
              type="button"
              className="db__tool"
              aria-label="Remove filter"
              onClick={() => onChange({ filters: view.filters.filter((_, at) => at !== index) })}
            >
              Remove
            </button>
          </div>
        );
      })}
      {first ? (
        <button
          type="button"
          className="db__tool"
          onClick={() =>
            onChange({
              filters: [
                ...view.filters,
                { property: first.id, op: OPS_FOR_TYPE[first.type][0] ?? 'is', value: null },
              ],
            })
          }
        >
          <Plus size={12} />
          Add a filter
        </button>
      ) : null}
    </div>
  );
}

interface FilterValueProps {
  property: DbProperty;
  value: PropValue;
  onChange: (value: PropValue) => void;
}

function FilterValue({ property, value, onChange }: FilterValueProps) {
  if (property.type === 'select' || property.type === 'multi_select') {
    return (
      <select
        className="db__select"
        aria-label="Filter value"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value.length > 0 ? event.target.value : null)}
      >
        <option value="">Choose an option</option>
        {property.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === 'checkbox') {
    return (
      <select
        className="db__select"
        aria-label="Filter value"
        value={value === true ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value === 'true')}
      >
        <option value="true">Checked</option>
        <option value="false">Not checked</option>
      </select>
    );
  }

  return <FilterText property={property} value={value} onChange={onChange} />;
}

/**
 * The typed half of a filter. Every save rewrites the whole view, so the box commits on blur
 * rather than on each keystroke: otherwise a refetch lands mid-word and takes the rest away.
 */
function FilterText({ property, value, onChange }: FilterValueProps) {
  const asText = (raw: PropValue): string =>
    raw === null || typeof raw === 'boolean' || Array.isArray(raw) ? '' : String(raw);
  const [draft, setDraft] = useState(() => asText(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(asText(value));
  }, [value]);

  const commit = (): void => {
    const text = draft.trim();
    if (text.length === 0) {
      if (value !== null) onChange(null);
      return;
    }
    const next = property.type === 'number' ? Number(text) : text;
    if (next !== value) onChange(next);
  };

  return (
    <input
      className="input"
      type={property.type === 'date' ? 'date' : 'text'}
      aria-label="Filter value"
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
  );
}

function SortPanel({ database, view, onChange }: PanelProps) {
  const first = database.properties[0];

  return (
    <div className="db__panel" aria-label="Sorts">
      {view.sorts.map((sort, index) => (
        <div className="db__panel-row" key={`${sort.property}-${index}`}>
          <select
            className="db__select"
            aria-label="Sort property"
            value={sort.property}
            onChange={(event) =>
              onChange({
                sorts: view.sorts.map((entry, at) =>
                  at === index ? { ...entry, property: event.target.value } : entry,
                ),
              })
            }
          >
            {database.properties.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <select
            className="db__select"
            aria-label="Sort direction"
            value={sort.direction}
            onChange={(event) =>
              onChange({
                sorts: view.sorts.map((entry, at) =>
                  at === index
                    ? { ...entry, direction: event.target.value === 'desc' ? 'desc' : 'asc' }
                    : entry,
                ),
              })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button
            type="button"
            className="db__tool"
            aria-label="Remove sort"
            onClick={() => onChange({ sorts: view.sorts.filter((_, at) => at !== index) })}
          >
            Remove
          </button>
        </div>
      ))}
      {first ? (
        <button
          type="button"
          className="db__tool"
          onClick={() =>
            onChange({ sorts: [...view.sorts, { property: first.id, direction: 'asc' }] })
          }
        >
          <Plus size={12} />
          Add a sort
        </button>
      ) : null}
    </div>
  );
}

function PropertiesPanel({
  database,
  view,
  onChange,
  onAddProperty,
}: PanelProps & { onAddProperty: () => void }) {
  return (
    <div className="db__panel" aria-label="Properties">
      {database.properties.map((property) => {
        const visible = !view.hidden.includes(property.id);
        return (
          <div className="db__panel-row" key={property.id}>
            <label className="db__panel-row">
              <input
                type="checkbox"
                checked={visible}
                onChange={() =>
                  onChange({
                    hidden: visible
                      ? [...view.hidden, property.id]
                      : view.hidden.filter((id) => id !== property.id),
                  })
                }
              />
              {property.name}
            </label>
            <span className="faint">{TYPE_LABEL[property.type]}</span>
          </div>
        );
      })}
      <button type="button" className="db__tool" onClick={onAddProperty}>
        <Plus size={12} />
        Add a property
      </button>
    </div>
  );
}
