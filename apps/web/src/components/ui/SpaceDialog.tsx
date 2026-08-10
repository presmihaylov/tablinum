import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCustomEmoji, useCustomEmojiEntries } from '../../lib/customEmoji';
import { filterEmoji } from '../../lib/emoji';
import type { EmojiEntry } from '../../lib/emoji';
import { EmojiGlyph } from './EmojiGlyph';
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
  const [seeded, setSeeded] = useState<SpaceDialogRequest | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Seeded while rendering, not in an effect. React flushes an effect after the paint, so a
  // seed that lives in one can wipe the first keys somebody types into the open dialog.
  if (request !== seeded) {
    setSeeded(request);
    setName(request?.initialName ?? '');
    setIcon(request?.initialIcon ?? null);
    setQuery('');
  }

  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => clearTimeout(timer);
  }, [request]);

  const uploaded = useCustomEmojiEntries();
  const custom = useMemo(() => filterCustomEmoji(query, uploaded), [query, uploaded]);
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
            <EmojiGlyph value={icon ?? '◆'} />
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
        {custom.length === 0 ? null : (
          <>
            <p className="space-dialog__section">Custom</p>
            <div className="space-dialog__grid" role="listbox" aria-label="Custom icon">
              {custom.map((entry) => (
                <IconChoice
                  key={entry.src}
                  entry={entry}
                  selected={entry.char === icon}
                  onPick={setIcon}
                />
              ))}
            </div>
            <p className="space-dialog__section">Emoji</p>
          </>
        )}
        <div className="space-dialog__grid" role="listbox" aria-label="Icon">
          {choices.map((entry) => (
            <IconChoice
              key={entry.char}
              entry={entry}
              selected={entry.char === icon}
              onPick={setIcon}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

interface IconChoiceProps {
  entry: EmojiEntry;
  selected: boolean;
  onPick: (icon: string) => void;
}

function IconChoice({ entry, selected, onPick }: IconChoiceProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={entry.name}
      title={entry.name}
      className={selected ? 'space-dialog__emoji is-on' : 'space-dialog__emoji'}
      onClick={() => onPick(entry.char)}
    >
      <EmojiGlyph value={entry.char} />
    </button>
  );
}
