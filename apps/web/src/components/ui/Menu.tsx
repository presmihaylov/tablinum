import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { placeMenu, type MenuAlign, type MenuSpot, type TriggerBox } from '../../lib/menuPlacement';
import './popmenu.css';

/** What a menu opens against: an element, or a bare point such as the spot a right-click hit. */
export type MenuAnchor = RefObject<HTMLElement | null> | TriggerBox;

function boxOf(anchor: MenuAnchor): TriggerBox | null {
  if (!('current' in anchor)) return anchor;
  return anchor.current?.getBoundingClientRect() ?? null;
}

/**
 * Holds the menu against the control that opened it. The menu is fixed to the viewport, so it
 * needs no room in the layout around it.
 */
function useMenuPlacement(anchor: MenuAnchor, align: MenuAlign) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<MenuSpot | null>(null);

  useLayoutEffect(() => {
    const place = (): void => {
      const trigger = boxOf(anchor);
      const menu = ref.current;
      if (trigger === null || menu === null) return;
      const view = { width: window.innerWidth, height: window.innerHeight };
      const spot = placeMenu(trigger, menu.getBoundingClientRect(), view, align);
      // The menu measures itself on every scroll, so hand back the old spot when nothing moved.
      setAt((prev) => (prev !== null && prev.top === spot.top && prev.left === spot.left ? prev : spot));
    };

    place();
    window.addEventListener('resize', place);
    // A scroll anywhere above the trigger moves it, so every scroller on the way up counts.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align]);

  return {
    ref,
    // The first paint measures the menu. Showing it then would put it at the corner for a frame.
    style: {
      top: at?.top ?? 0,
      left: at?.left ?? 0,
      visibility: at === null ? ('hidden' as const) : ('visible' as const),
    },
  };
}

interface MenuProps {
  label: string;
  /** The control that opened the menu. The menu is placed under it, or over it if room runs out. */
  anchor: MenuAnchor;
  align?: MenuAlign;
  /** The look of the panel. The layer it draws in belongs to this component, not to the caller. */
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Every menu the app opens against a control. It draws in a layer on the body: inside the page a
 * scroller cut it off, so a menu near an edge opened where nobody could read it.
 */
export function Menu({
  label,
  anchor,
  align = 'left',
  className = 'popmenu',
  onClose,
  children,
}: MenuProps) {
  const { ref, style } = useMenuPlacement(anchor, align);

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
  }, [onClose, ref]);

  return createPortal(
    <div
      ref={ref}
      className={`menu-layer ${className}`}
      role="menu"
      aria-label={label}
      style={style}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
