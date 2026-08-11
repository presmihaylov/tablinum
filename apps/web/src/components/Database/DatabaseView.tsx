import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_BOARD_NAME,
  DEFAULT_VIEW_NAME,
  OPS_FOR_TYPE,
  applyView,
  boardProperty,
  databaseRev,
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
  type RowProps,
  type SelectOption,
  type ViewType,
} from '@tablinum/shared';
import {
  useCreateRow,
  useDatabase,
  useDeleteRow,
  useSetDatabase,
  useUpdateRow,
  useUsers,
} from '../../api/hooks';
import { useToast } from '../../lib/toast';
import { Plus } from '../ui/Icon';
import { nextOptionColor } from './Cell';
import { BoardView, type RowMove } from './BoardView';
import { Pop } from './Pop';
import { RecordPanel } from './RecordPanel';
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
  const deleteRow = useDeleteRow();

  const [viewId, setViewId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);

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

  // Read back from the list every render, so an edit made in the panel shows up in the panel.
  const openRow = useMemo<DbRow | null>(
    () => rows.find((row) => row.id === openRowId) ?? null,
    [rows, openRowId],
  );

  if (database === null || view === null) return null;

  // Every edit here is built from `database`, so it says so and the server merges rather than
  // replaces. Two quick clicks on "Add a property" then leave two properties, not one.
  const baseRev = databaseRev(database);

  const save = (next: Database): void => {
    setDatabase.mutate(
      { pageId: page.id, database: next, baseRev },
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

  const addView = (type: ViewType): void => {
    const base = type === 'board' ? DEFAULT_BOARD_NAME : DEFAULT_VIEW_NAME;
    const next: DbView = {
      id: newViewId(),
      name: `${base} ${database.views.length + 1}`,
      type,
      filters: [],
      sorts: [],
      hidden: [],
    };
    // A board needs a column to stack by, and the first select one is the obvious guess.
    const group = database.properties.find((entry) => entry.type === 'select');
    if (type === 'board' && group !== undefined) next.groupBy = group.id;
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
        baseRev,
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

  /** A card dropped on the board: the cell it lands in, where it sits in the file, or both. */
  const moveRow = (rowId: string, move: RowMove): void => {
    updateRow.mutate(
      { pageId: page.id, rowId, body: move },
      { onError: (error) => toast.pushError(error, 'The card could not be moved') },
    );
  };

  const changeTitle = (rowId: string, title: string): void => {
    updateRow.mutate(
      { pageId: page.id, rowId, body: { title } },
      { onError: (error) => toast.pushError(error, 'The row could not be renamed') },
    );
  };

  const addRow = (props: RowProps = {}): void => {
    const body = Object.keys(props).length === 0 ? {} : { props };
    createRow.mutate(
      { pageId: page.id, body },
      { onError: (error) => toast.pushError(error, 'The row could not be created') },
    );
  };

  const removeView = (): void => {
    // The last view is what draws the database at all, so it stays.
    if (database.views.length < 2) return;
    setViewId(null);
    save({ ...database, views: database.views.filter((entry) => entry.id !== view.id) });
  };

  const removeRow = (row: DbRow): void => {
    deleteRow.mutate(
      { pageId: page.id, rowId: row.id },
      { onError: (error) => toast.pushError(error, 'The row could not be deleted') },
    );
  };

  const togglePanel = (next: Exclude<Panel, null>): void =>
    setPanel((prev) => (prev === next ? null : next));

  return (
    <section className="db" aria-label="Database">
      <div className="db__bar">
        <div className="db__views" role="tablist" aria-label="Database views">
          {database.views.map((entry) =>
            entry.id === view.id ? (
              <ViewTab
                key={entry.id}
                database={database}
                view={view}
                onChange={patchView}
                onDelete={database.views.length > 1 ? removeView : null}
              />
            ) : (
              <button
                key={entry.id}
                type="button"
                role="tab"
                className="db__view"
                aria-selected={false}
                onClick={() => setViewId(entry.id)}
              >
                {entry.name}
              </button>
            ),
          )}
          <AddView onAdd={addView} />
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
          <button type="button" className="btn btn--primary" onClick={() => addRow()}>
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

      {view.type === 'board' ? (
        <BoardView
          database={database}
          view={view}
          rows={rows}
          people={people}
          onMoveRow={moveRow}
          onCreateRow={addRow}
          onDeleteRow={removeRow}
          onOpenRow={(row) => setOpenRowId(row.id)}
          onDatabaseChange={save}
          onCreateOption={createOption}
        />
      ) : (
        <TableView
          database={database}
          view={view}
          rows={shown}
          people={people}
          pageId={page.id}
          onDatabaseChange={save}
          onAddProperty={addProperty}
          onCellChange={changeCell}
          onTitleChange={changeTitle}
          onCreateRow={() => addRow()}
          onDeleteRow={removeRow}
          onOpenRow={(row) => setOpenRowId(row.id)}
          onCreateOption={createOption}
        />
      )}

      {rows.length === 0 ? <p className="db__empty">This database has no rows yet.</p> : null}

      {openRow === null ? null : (
        <RecordPanel
          row={openRow}
          properties={database.properties}
          people={people}
          onClose={() => setOpenRowId(null)}
          onTitleChange={(title) => changeTitle(openRow.id, title)}
          onCellChange={(propertyId, value) => changeCell(openRow.id, propertyId, value)}
          onCreateOption={createOption}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

interface ViewTabProps {
  database: Database;
  view: DbView;
  onChange: (patch: Partial<DbView>) => void;
  /** Null for the last view, which the database cannot be drawn without. */
  onDelete: (() => void) | null;
}

/** The open view. Clicking it again opens the menu that renames it or changes its layout. */
function ViewTab({ database, view, onChange, onDelete }: ViewTabProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(view.name);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setName(view.name), [view.name]);

  const commitName = (): void => {
    const next = name.trim();
    if (next.length === 0 || next === view.name) {
      setName(view.name);
      return;
    }
    onChange({ name: next });
  };

  const selects = database.properties.filter((entry) => entry.type === 'select');
  const group = boardProperty(database, view);

  const changeType = (type: ViewType): void => {
    if (type !== 'board') {
      onChange({ type });
      return;
    }
    // A board without a column to stack by would draw nothing, so it takes the first select one.
    onChange(group === null ? { type } : { type, groupBy: group.id });
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="tab"
        className="db__view db__view--on"
        aria-selected={true}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {view.name}
      </button>
      {open ? (
        <Pop label="View menu" anchor={trigger} onClose={() => setOpen(false)}>
          <input
            className="input"
            autoFocus
            aria-label="View name"
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
          <div className="db-pop__label">Layout</div>
          <select
            className="db__select"
            aria-label="View layout"
            value={view.type}
            onChange={(event) => changeType(event.target.value as ViewType)}
          >
            <option value="table">Table</option>
            <option value="board">Board</option>
          </select>
          {view.type === 'board' ? (
            <>
              <div className="db-pop__label">Group by</div>
              <select
                className="db__select"
                aria-label="Group by"
                value={group?.id ?? ''}
                onChange={(event) => onChange({ groupBy: event.target.value })}
              >
                {selects.length === 0 ? <option value="">No select column yet</option> : null}
                {selects.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {onDelete === null ? null : (
            <>
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
                Delete view
              </button>
            </>
          )}
        </Pop>
      ) : null}
    </>
  );
}

function AddView({ onAdd }: { onAdd: (type: ViewType) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="db__view"
        aria-label="Add a view"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Plus size={12} />
      </button>
      {open ? (
        <Pop label="New view" anchor={trigger} onClose={() => setOpen(false)}>
          {(['table', 'board'] as const).map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="db-pop__item"
              onClick={() => {
                setOpen(false);
                onAdd(type);
              }}
            >
              {type === 'board' ? 'Board' : 'Table'}
            </button>
          ))}
        </Pop>
      ) : null}
    </>
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
