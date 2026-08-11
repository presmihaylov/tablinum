import type { ReactNode } from 'react';
import './menu.css';

interface MenuListProps<I> {
  items: readonly I[];
  /** The row the keys sit on. */
  active: number;
  label: string;
  /** How wide and how tall the box is, and where it sits. The list itself has no size. */
  className?: string;
  keyOf: (item: I) => string;
  renderRow: (item: I) => ReactNode;
  onHover: (index: number) => void;
  onPick: (item: I) => void;
}

function boxClass(className: string | undefined): string {
  return className === undefined ? 'menu' : `menu ${className}`;
}

/**
 * The box every menu draws, and the rows in it. The caller says what a row holds and which one
 * the keys sit on; a caret menu, a picker and the comment composer all keep their own keys.
 */
export function MenuList<I>({
  items,
  active,
  label,
  className,
  keyOf,
  renderRow,
  onHover,
  onPick,
}: MenuListProps<I>) {
  return (
    <div className={boxClass(className)} role="listbox" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={keyOf(item)}
          type="button"
          role="option"
          aria-selected={index === active}
          className={`menu__item${index === active ? ' is-active' : ''}`}
          onMouseEnter={() => onHover(index)}
          // The caret must keep the focus, or the menu closes before the click lands.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(item)}
        >
          {renderRow(item)}
        </button>
      ))}
    </div>
  );
}

/** The same box with a line of prose in it, for when there is nothing to offer. */
export function MenuEmpty({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`${boxClass(className)} menu--empty`}>{children}</div>;
}
