import { useEffect, useMemo, useRef, useState } from 'react';
import { filterEmoji } from '../../lib/emoji';
import { Modal } from './Overlay';

export interface SpaceDraft {
  name: string;
  /** One emoji, or null for the default mark. */
  icon: string | null;
}

export interface SpaceDialogRequest {
  title: string;
  confirmLabel?: string;
  /** What the name field is called. A workspace uses the same dialog. */
  nameLabel?: string;
  initialName?: string;
  initialIcon?: string | null;
  onConfirm: (draft: SpaceDraft) => void;
}

interface SpaceDialogProps {
  request: SpaceDialogRequest | null;
  onClose: () => void;
}

const GRID_LIMIT = 60;

/** Name plus icon, used to create a space and to edit one. */
export function SpaceDialog({ request, onClose }: SpaceDialogProps) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!request) return;
    setName(request.initialName ?? '');
    setIcon(request.initialIcon ?? null);
    setQuery('');
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => clearTimeout(timer);
  }, [request]);

  const choices = useMemo(() => filterEmoji(query).slice(0, GRID_LIMIT), [query]);

  if (!request) return null;

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onClose();
    request.onConfirm({ name: trimmed, icon });
  };

  return (
    <Modal
      open
      title={request.title}
      onClose={onClose}
      width="26rem"
      footer={
        <>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={name.trim().length === 0}
          >
            {request.confirmLabel ?? 'Save'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">{request.nameLabel ?? 'Space name'}</span>
        <input
          ref={inputRef}
          className="input"
          value={name}
          placeholder="Engineering"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
        />
      </label>

      <div className="field space-dialog__icons">
        <span className="field__label">Icon</span>
        <div className="space-dialog__row">
          <span className="space-dialog__preview" aria-label="Selected icon">
            {icon ?? '◆'}
          </span>
          <input
            className="input"
            value={query}
            placeholder="Search icons"
            aria-label="Search icons"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => setIcon(null)}
            disabled={icon === null}
          >
            Clear
          </button>
        </div>
        <div className="space-dialog__grid" role="listbox" aria-label="Icon">
          {choices.map((entry) => (
            <button
              key={entry.char}
              type="button"
              role="option"
              aria-selected={entry.char === icon}
              aria-label={entry.name}
              title={entry.name}
              className={
                entry.char === icon ? 'space-dialog__emoji is-on' : 'space-dialog__emoji'
              }
              onClick={() => setIcon(entry.char)}
            >
              {entry.char}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
