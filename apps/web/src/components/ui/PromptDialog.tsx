import { useEffect, useRef, useState } from 'react';
import { Modal } from './Overlay';

export interface PromptRequest {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
}

interface PromptDialogProps {
  request: PromptRequest | null;
  onClose: () => void;
}

/** One-field dialog used for rename, new page and new space. */
export function PromptDialog({ request, onClose }: PromptDialogProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!request) return;
    setValue(request.initialValue ?? '');
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => clearTimeout(timer);
  }, [request]);

  if (!request) return null;

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onClose();
    request.onConfirm(trimmed);
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
          <button type="button" className="btn btn--primary" onClick={submit} disabled={value.trim().length === 0}>
            {request.confirmLabel ?? 'Save'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">{request.label}</span>
        <input
          ref={inputRef}
          className="input"
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
        />
      </label>
    </Modal>
  );
}
