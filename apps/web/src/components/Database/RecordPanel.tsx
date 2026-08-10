import { useEffect, useState } from 'react';
import type { Account, DbProperty, DbRow, PropValue, SelectOption } from '@tablinum/shared';
import { Modal } from '../ui/Overlay';
import { Cell } from './Cell';
import { TYPE_LABEL } from './PropertyHead';

interface RecordPanelProps {
  row: DbRow;
  properties: readonly DbProperty[];
  people: Account[];
  onClose: () => void;
  onTitleChange: (title: string) => void;
  onCellChange: (propertyId: string, value: PropValue) => void;
  onCreateOption: (property: DbProperty, name: string) => Promise<SelectOption | null>;
}

/**
 * One row, opened on its own. A row is a record inside the database page, so it has no page of
 * its own to navigate to and every field is edited here instead.
 */
export function RecordPanel({
  row,
  properties,
  people,
  onClose,
  onTitleChange,
  onCellChange,
  onCreateOption,
}: RecordPanelProps) {
  const [title, setTitle] = useState(row.title);

  useEffect(() => setTitle(row.title), [row.title]);

  const commitTitle = (): void => {
    const next = title.trim();
    if (next.length === 0 || next === row.title) {
      setTitle(row.title);
      return;
    }
    onTitleChange(next);
  };

  return (
    <Modal open title={row.title} onClose={onClose} width="34rem">
      <div className="db-record">
        <input
          className="db-record__title"
          aria-label="Row title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />

        <dl className="db-record__fields">
          {properties.map((property) => (
            <div className="db-record__field" key={property.id}>
              <dt className="db-record__label" title={TYPE_LABEL[property.type]}>
                {property.name}
              </dt>
              <dd className="db-record__value">
                <Cell
                  property={property}
                  value={row.props[property.id] ?? null}
                  people={people}
                  onChange={(value) => onCellChange(property.id, value)}
                  onCreateOption={onCreateOption}
                />
              </dd>
            </div>
          ))}
        </dl>

        {properties.length === 0 ? (
          <p className="empty-note">This database has no properties yet.</p>
        ) : null}
      </div>
    </Modal>
  );
}
