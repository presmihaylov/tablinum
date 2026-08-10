import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Close } from './Icon';
import './overlay.css';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Modal({ open, title, onClose, children, footer, width = '32rem' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className="modal__body scroll-y">{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  /** Draw a rule above this item, to set it apart from the group before it. */
  divider?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Keep the menu inside the viewport without measuring: clamp against a nominal size.
  const rules = items.filter((item) => item.divider).length;
  const left = Math.min(x, window.innerWidth - 208);
  const top = Math.min(y, window.innerHeight - (items.length * 30 + rules * 9 + 16));

  return createPortal(
    <div ref={ref} className="context-menu" style={{ left, top }} role="menu">
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.divider ? <div className="context-menu__rule" /> : null}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? 'context-menu__item context-menu__item--danger' : 'context-menu__item'}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="context-menu__icon">{item.icon}</span>
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
