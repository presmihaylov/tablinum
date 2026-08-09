import { useEffect, useState } from 'react';
import { EmojiGlyph } from './EmojiGlyph';
import { Modal } from './Overlay';

export interface SpaceOption {
  slug: string;
  name: string;
  icon?: string;
}

export interface SpacePickerRequest {
  title: string;
  label: string;
  options: SpaceOption[];
  confirmLabel?: string;
  onConfirm: (slug: string) => void;
}

interface SpacePickerDialogProps {
  request: SpacePickerRequest | null;
  onClose: () => void;
}

/** Pick one space from a list. Used to move a page into another space. */
export function SpacePickerDialog({ request, onClose }: SpacePickerDialogProps) {
  const [slug, setSlug] = useState('');

  useEffect(() => {
    setSlug(request?.options[0]?.slug ?? '');
  }, [request]);

  if (!request) return null;

  const submit = (): void => {
    if (slug.length === 0) return;
    onClose();
    request.onConfirm(slug);
  };

  return (
    <Modal
      open
      title={request.title}
      onClose={onClose}
      width="24rem"
      footer={
        <>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={slug.length === 0}
          >
            {request.confirmLabel ?? 'Move'}
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">{request.label}</span>
        <div className="picker" role="listbox" aria-label={request.label}>
          {request.options.map((option) => (
            <button
              key={option.slug}
              type="button"
              role="option"
              aria-selected={option.slug === slug}
              className={option.slug === slug ? 'picker__item picker__item--on' : 'picker__item'}
              onClick={() => setSlug(option.slug)}
              onDoubleClick={submit}
            >
              <span className="picker__icon">
                <EmojiGlyph value={option.icon ?? '#'} />
              </span>
              <span className="picker__label">{option.name}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
