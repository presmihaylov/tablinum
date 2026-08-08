import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PagePath, PropValue, ViewsQuery } from '@gitdocs/shared';
import { useViews } from '../../api/hooks';
import { relativeTime } from '../../lib/format';
import { pageHref } from '../../lib/href';
import { formatPropValue } from '../../lib/propTypes';
import { ChevronDown, ChevronRight, Close, Plus } from '../ui/Icon';
import './tableview.css';

interface Filter {
  id: number;
  key: string;
  value: string;
}

interface TableViewProps {
  dir: PagePath;
}

type SortOrder = 'asc' | 'desc';

/** Database-style view over the frontmatter props of a page's children. */
export function TableView({ dir }: TableViewProps) {
  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<SortOrder>('asc');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [nextFilterId, setNextFilterId] = useState(1);

  const where = useMemo(
    () =>
      filters
        .filter((filter) => filter.key.trim().length > 0)
        .map((filter) => `${filter.key.trim()}:${filter.value.trim()}`)
        .join(','),
    [filters],
  );

  const query = useMemo<ViewsQuery>(() => {
    const base: ViewsQuery = { dir };
    if (where.length > 0) base.where = where;
    if (sort) {
      base.sort = sort;
      base.order = order;
    }
    return base;
  }, [dir, where, sort, order]);

  const views = useViews(query);
  const columns = views.data?.columns ?? [];
  const rows = views.data?.rows ?? [];

  const toggleSort = (column: string): void => {
    if (sort !== column) {
      setSort(column);
      setOrder('asc');
      return;
    }
    if (order === 'asc') {
      setOrder('desc');
      return;
    }
    setSort(null);
    setOrder('asc');
  };

  return (
    <div className="tableview">
      <div className="tableview__bar">
        {filters.map((filter) => (
          <div className="tableview__filter" key={filter.id}>
            <input
              className="tableview__filter-input"
              value={filter.key}
              placeholder="property"
              aria-label="Filter property"
              onChange={(event) =>
                setFilters((prev) =>
                  prev.map((entry) => (entry.id === filter.id ? { ...entry, key: event.target.value } : entry)),
                )
              }
            />
            <span className="tableview__filter-op">is</span>
            <input
              className="tableview__filter-input"
              value={filter.value}
              placeholder="value"
              aria-label="Filter value"
              onChange={(event) =>
                setFilters((prev) =>
                  prev.map((entry) => (entry.id === filter.id ? { ...entry, value: event.target.value } : entry)),
                )
              }
            />
            <button
              type="button"
              className="tableview__filter-remove"
              aria-label="Remove filter"
              onClick={() => setFilters((prev) => prev.filter((entry) => entry.id !== filter.id))}
            >
              <Close size={10} />
            </button>
          </div>
        ))}

        <button
          type="button"
          className="btn"
          onClick={() => {
            setFilters((prev) => [...prev, { id: nextFilterId, key: columns[0] ?? '', value: '' }]);
            setNextFilterId((prev) => prev + 1);
          }}
        >
          <Plus size={12} />
          Filter
        </button>

        <span className="tableview__count">
          {rows.length} page{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {views.isError ? <p className="empty-note">This view cannot be loaded.</p> : null}

      <div className="tableview__scroll">
        <table className="tableview__table">
          <thead>
            <tr>
              <th scope="col" className="tableview__th tableview__th--title">
                Page
              </th>
              {columns.map((column) => (
                <th key={column} scope="col" className="tableview__th">
                  <button type="button" className="tableview__sort" onClick={() => toggleSort(column)}>
                    {column}
                    {sort === column ? (
                      order === 'asc' ? (
                        <ChevronDown size={10} />
                      ) : (
                        <ChevronRight size={10} />
                      )
                    ) : null}
                  </button>
                </th>
              ))}
              <th scope="col" className="tableview__th">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="tableview__td tableview__td--title">
                  <Link to={pageHref(row.path)} className="tableview__link">
                    <span className="tableview__icon">{row.icon ?? '·'}</span>
                    {row.title}
                  </Link>
                </td>
                {columns.map((column) => (
                  <td key={column} className="tableview__td">
                    <Cell value={row.props[column] ?? null} />
                  </td>
                ))}
                <td className="tableview__td faint">{relativeTime(row.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!views.isLoading && rows.length === 0 ? <p className="empty-note">No child pages match.</p> : null}
      </div>
    </div>
  );
}

function Cell({ value }: { value: PropValue }) {
  if (Array.isArray(value)) {
    return (
      <span className="tableview__chips">
        {value.map((item) => (
          <span className="chip" key={item}>
            {item}
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === 'boolean') return <span>{value ? '✓' : '—'}</span>;
  if (value === null) return <span className="faint">—</span>;
  return <span>{formatPropValue(value)}</span>;
}
