import type { ReactNode } from 'react';
import { ChevronRight, Plus } from '../ui/Icon';

interface SectionAction {
  label: string;
  onSelect: () => void;
}

interface SidebarSectionProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** The "+" at the right of the header. Absent when the bucket has nothing to add. */
  action?: SectionAction;
  children: ReactNode;
}

/** One bucket of the sidebar: a heading that folds away, and whatever it holds. */
export function SidebarSection({ label, open, onToggle, action, children }: SidebarSectionProps) {
  return (
    <section className="sidebar-section" aria-label={label}>
      <div className="sidebar-section__head">
        <button
          type="button"
          className="sidebar-section__toggle"
          onClick={onToggle}
          aria-expanded={open}
        >
          <ChevronRight
            size={12}
            className={open ? 'sidebar-section__caret sidebar-section__caret--open' : 'sidebar-section__caret'}
          />
          {label}
        </button>

        {action ? (
          <button
            type="button"
            className="sidebar-section__action"
            aria-label={action.label}
            title={action.label}
            onClick={action.onSelect}
          >
            <Plus size={12} />
          </button>
        ) : null}
      </div>

      {open ? <div className="sidebar-section__body">{children}</div> : null}
    </section>
  );
}
