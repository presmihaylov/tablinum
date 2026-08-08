import { useEffect, useMemo, useState } from 'react';
import type { PropValue } from '@gitdocs/shared';
import {
  PROP_TYPES,
  PROP_TYPE_LABELS,
  convertPropValue,
  coercePropValue,
  formatPropValue,
  inferPropType,
  inferTypeFromInput,
  type PropType,
} from '../../lib/propTypes';
import { Plus, Trash } from '../ui/Icon';

interface Row {
  rowId: string;
  key: string;
  type: PropType;
  value: PropValue;
}

interface PropsTableProps {
  value: Record<string, PropValue>;
  /** Changing this rebuilds the rows from `value`: pass the page id. */
  resetKey: string;
  onChange: (props: Record<string, PropValue>) => void;
}

let rowCounter = 0;
const nextRowId = (): string => {
  rowCounter += 1;
  return `row-${rowCounter}`;
};

function toRows(props: Record<string, PropValue>): Row[] {
  return Object.entries(props).map(([key, value]) => ({
    rowId: nextRowId(),
    key,
    type: inferPropType(value),
    value,
  }));
}

function toProps(rows: readonly Row[]): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key.length === 0) continue;
    out[key] = row.value;
  }
  return out;
}

/** Editable frontmatter property table. Each row carries its own inferred type. */
export function PropsTable({ value, resetKey, onChange }: PropsTableProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));

  useEffect(() => {
    setRows(toRows(value));
    // Rows are local while the user types; only a different page resets them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const commit = (next: Row[]): void => {
    setRows(next);
    onChange(toProps(next));
  };

  const update = (rowId: string, patch: Partial<Row>): void => {
    commit(rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  };

  const duplicateKeys = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const row of rows) {
      const key = row.key.trim();
      if (key.length === 0) continue;
      if (seen.has(key)) dupes.add(key);
      seen.add(key);
    }
    return dupes;
  }, [rows]);

  return (
    <div className="props">
      {rows.map((row) => (
        <div className="props__row" key={row.rowId}>
          <input
            className={duplicateKeys.has(row.key.trim()) ? 'input input--bare props__key is-duplicate' : 'input input--bare props__key'}
            value={row.key}
            placeholder="Property"
            aria-label="Property name"
            onChange={(event) => update(row.rowId, { key: event.target.value })}
          />

          <select
            className="props__type"
            value={row.type}
            aria-label={`Type of ${row.key || 'the property'}`}
            onChange={(event) => {
              const type = event.target.value as PropType;
              update(row.rowId, { type, value: convertPropValue(row.value, type) });
            }}
          >
            {PROP_TYPES.map((type) => (
              <option key={type} value={type}>
                {PROP_TYPE_LABELS[type]}
              </option>
            ))}
          </select>

          <PropValueInput
            row={row}
            onValue={(next) => update(row.rowId, { value: next })}
            onTypeAndValue={(type, next) => update(row.rowId, { type, value: next })}
          />

          <button
            type="button"
            className="props__remove"
            aria-label={`Remove ${row.key || 'property'}`}
            onClick={() => commit(rows.filter((entry) => entry.rowId !== row.rowId))}
          >
            <Trash size={12} />
          </button>
        </div>
      ))}

      <button
        type="button"
        className="props__add"
        onClick={() => setRows((prev) => [...prev, { rowId: nextRowId(), key: '', type: 'text', value: null }])}
      >
        <Plus size={12} />
        Add property
      </button>
    </div>
  );
}

interface PropValueInputProps {
  row: Row;
  onValue: (value: PropValue) => void;
  onTypeAndValue: (type: PropType, value: PropValue) => void;
}

function PropValueInput({ row, onValue, onTypeAndValue }: PropValueInputProps) {
  if (row.type === 'boolean') {
    return (
      <label className="props__value props__value--check">
        <input
          type="checkbox"
          checked={row.value === true}
          aria-label={`Value of ${row.key || 'the property'}`}
          onChange={(event) => onValue(event.target.checked)}
        />
        <span>{row.value === true ? 'Yes' : 'No'}</span>
      </label>
    );
  }

  if (row.type === 'date') {
    return (
      <input
        type="date"
        className="input input--bare props__value"
        aria-label={`Value of ${row.key || 'the property'}`}
        value={formatPropValue(row.value).slice(0, 10)}
        onChange={(event) => onValue(event.target.value.length > 0 ? event.target.value : null)}
      />
    );
  }

  return (
    <input
      className="input input--bare props__value"
      aria-label={`Value of ${row.key || 'the property'}`}
      placeholder={row.type === 'multi' ? 'a, b, c' : 'Empty'}
      value={formatPropValue(row.value)}
      onChange={(event) => {
        const raw = event.target.value;
        // A fresh text row adopts the type of whatever the user typed.
        if (row.type === 'text') {
          const guessed = inferTypeFromInput(raw);
          if (guessed !== 'text') {
            onTypeAndValue(guessed, coercePropValue(raw, guessed));
            return;
          }
        }
        onValue(coercePropValue(raw, row.type));
      }}
    />
  );
}
