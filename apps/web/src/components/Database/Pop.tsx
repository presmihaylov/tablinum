import { useEffect, useRef, type ReactNode } from 'react';

interface PopProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A small menu anchored to the cell or header it sits in. It stays in the table's own stacking
 * context rather than a portal, so it scrolls with the grid and needs no position measurement.
 */
export function Pop({ label, onClose, children }: PopProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    // The click that opened this menu still bubbles up to the window, and its target sits outside
    // this element. Subscribe one tick later, or the menu closes the moment it opens.
    const timer = window.setTimeout(() => window.addEventListener('click', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('click', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="db-pop"
      role="menu"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
