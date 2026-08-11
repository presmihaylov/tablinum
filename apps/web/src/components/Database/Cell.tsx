import { useEffect, useRef, useState } from 'react';
import {
  OPTION_COLORS,
  dateStart,
  optionByName,
  type Account,
  type DbProperty,
  type OptionColor,
  type PropValue,
  type SelectOption,
} from '@tablinum/shared';
import { Check, Plus } from '../ui/Icon';
import { Menu } from '../ui/Menu';

export interface CellProps {
  property: DbProperty;
  value: PropValue;
  people: Account[];
  onChange: (value: PropValue) => void;
  /** Add an option to the schema and return it, so a cell can name a value that did not exist. */
  onCreateOption: (property: DbProperty, name: string) => Promise<SelectOption | null>;
}

export function Cell(props: CellProps) {
  switch (props.property.type) {
    case 'checkbox':
      return <CheckboxCell {...props} />;
    case 'number':
      return <TextCell {...props} kind="number" />;
    case 'url':
      return <TextCell {...props} kind="url" />;
    case 'date':
      return <DateCell {...props} />;
    case 'select':
      return <SelectCell {...props} multi={false} />;
    case 'multi_select':
      return <SelectCell {...props} multi />;
    case 'person':
      return <PersonCell {...props} />;
    default:
      return <TextCell {...props} kind="text" />;
  }
}

/** The colour a brand new option is given: the palette in order, so a list stays varied. */
export function nextOptionColor(taken: readonly SelectOption[]): OptionColor {
  const index = taken.length % OPTION_COLORS.length;
  return OPTION_COLORS[index] ?? 'gray';
}

/** A named, coloured pill. It draws an option, and anything else that reads like one. */
export function Tag({ option }: { option: Pick<SelectOption, 'name' | 'color'> }) {
  return <span className={`db-tag db-tag--${option.color}`}>{option.name}</span>;
}

// ---------------------------------------------------------------------------
// text, url, number
// ---------------------------------------------------------------------------

function asText(value: PropValue): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

function TextCell({ property, value, onChange, kind }: CellProps & { kind: 'text' | 'url' | 'number' }) {
  const [draft, setDraft] = useState(() => asText(value));
  const focused = useRef(false);

  // A refetch must not steal what is half-typed, so the server copy only wins when idle.
  useEffect(() => {
    if (!focused.current) setDraft(asText(value));
  }, [value]);

  const commit = (): void => {
    const text = draft.trim();
    if (text.length === 0) {
      if (value !== null) onChange(null);
      return;
    }
    if (kind === 'number') {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        setDraft(asText(value));
        return;
      }
      if (parsed !== value) onChange(parsed);
      return;
    }
    if (text !== value) onChange(text);
  };

  return (
    <input
      className="db-cell__input"
      type="text"
      inputMode={kind === 'number' ? 'decimal' : undefined}
      aria-label={property.name}
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
        if (event.key === 'Escape') {
          setDraft(asText(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// checkbox and date
// ---------------------------------------------------------------------------

function CheckboxCell({ property, value, onChange }: CellProps) {
  return (
    <div className="db-cell__check">
      <input
        type="checkbox"
        aria-label={property.name}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked ? true : null)}
      />
    </div>
  );
}

function DateCell({ property, value, onChange }: CellProps) {
  const current = typeof value === 'string' && value.length > 0 ? dateStart(value) : '';
  return (
    <input
      className="db-cell__input"
      type="date"
      aria-label={property.name}
      value={current}
      onChange={(event) => onChange(event.target.value.length > 0 ? event.target.value : null)}
    />
  );
}

// ---------------------------------------------------------------------------
// select and multi-select
// ---------------------------------------------------------------------------

function SelectCell({ property, value, onChange, onCreateOption, multi }: CellProps & { multi: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState('');

  const held = multi
    ? property.options.filter((option) => Array.isArray(value) && value.includes(option.id))
    : property.options.filter((option) => option.id === value);

  const text = query.trim();
  const shown = property.options.filter((option) =>
    option.name.toLowerCase().includes(text.toLowerCase()),
  );
  const exists = optionByName(property, text) !== null;

  const pick = (id: string): void => {
    if (!multi) {
      onChange(value === id ? null : id);
      setOpen(false);
      setQuery('');
      return;
    }
    const current = Array.isArray(value) ? value : [];
    const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    onChange(next.length > 0 ? next : null);
  };

  const create = async (): Promise<void> => {
    if (text.length === 0 || exists) return;
    const option = await onCreateOption(property, text);
    setQuery('');
    if (option === null) return;
    pick(option.id);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="db-cell__button"
        aria-label={property.name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {held.map((option) => (
          <Tag key={option.id} option={option} />
        ))}
      </button>
      {open ? (
        <Menu label={`${property.name} options`} anchor={trigger} onClose={() => setOpen(false)}>
          <input
            className="input"
            autoFocus
            placeholder="Search or create…"
            aria-label={`Search ${property.name} options`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const match = shown[0];
              if (!exists && text.length > 0) {
                void create();
                return;
              }
              if (match) pick(match.id);
            }}
          />
          <div className="popmenu__list">
            {shown.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                className="popmenu__item"
                onClick={() => pick(option.id)}
              >
                <Tag option={option} />
                {held.some((entry) => entry.id === option.id) ? <Check size={12} /> : null}
              </button>
            ))}
          </div>
          {text.length > 0 && !exists ? (
            <button type="button" role="menuitem" className="popmenu__item" onClick={() => void create()}>
              <Plus size={12} />
              Create “{text}”
            </button>
          ) : null}
        </Menu>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// person
// ---------------------------------------------------------------------------

function PersonCell({ property, value, people, onChange }: CellProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const held = Array.isArray(value) ? value : [];
  const named = held.map((id) => people.find((person) => person.id === id)?.name ?? id);

  const toggle = (id: string): void => {
    const next = held.includes(id) ? held.filter((entry) => entry !== id) : [...held, id];
    onChange(next.length > 0 ? next : null);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="db-cell__button"
        aria-label={property.name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {named.map((name) => (
          <span key={name} className="db-tag">
            {name}
          </span>
        ))}
      </button>
      {open ? (
        <Menu label={`${property.name} people`} anchor={trigger} onClose={() => setOpen(false)}>
          <div className="popmenu__list">
            {people
              .filter((person) => !person.disabled)
              .map((person) => (
                <button
                  key={person.id}
                  type="button"
                  role="menuitem"
                  className="popmenu__item"
                  onClick={() => toggle(person.id)}
                >
                  {person.name}
                  {held.includes(person.id) ? <Check size={12} /> : null}
                </button>
              ))}
          </div>
        </Menu>
      ) : null}
    </>
  );
}
