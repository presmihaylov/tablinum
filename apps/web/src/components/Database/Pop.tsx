import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

interface PopProps {
  label: string;
  /** The control that opened the menu. The menu is placed under it, or over it if room runs out. */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/** The space between the trigger and the menu, and the least the menu keeps from the edge. */
const GAP = 4;
const MARGIN = 8;

/**
 * A small menu for the cell, header or button that opened it. It draws in a layer on the body:
 * inside the grid the horizontal scroller cut it off, so a column near the right edge opened a
 * menu nobody could read.
 */
export function Pop({ label, anchor, onClose, children }: PopProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = (): void => {
      const trigger = anchor.current;
      const menu = ref.current;
      if (trigger === null || menu === null) return;
      const from = trigger.getBoundingClientRect();
      const size = menu.getBoundingClientRect();

      const under = from.bottom + GAP;
      const over = from.top - GAP - size.height;
      // Above the trigger only when the space below cannot hold the menu and the space above can.
      const tight = under + size.height > window.innerHeight - MARGIN;
      const top = tight && over > MARGIN ? over : under;

      const last = Math.max(MARGIN, window.innerWidth - size.width - MARGIN);
      setAt({ top, left: Math.min(Math.max(MARGIN, from.left), last) });
    };

    place();
    window.addEventListener('resize', place);
    // A scroll anywhere above the trigger moves it, so every scroller on the way up counts.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

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

  return createPortal(
    <div
      ref={ref}
      className="db-pop"
      role="menu"
      aria-label={label}
      // The first paint measures the menu. Showing it then would put it at the corner for a frame.
      style={{ top: at?.top ?? 0, left: at?.left ?? 0, visibility: at === null ? 'hidden' : 'visible' }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
