import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pageHref } from '../../lib/href';
import { useContent } from '../../lib/content';
import { EmojiGlyph } from '../ui/EmojiGlyph';
import { ChevronDown, Pencil, Plus } from '../ui/Icon';

export function SpaceSwitcher() {
  const navigate = useNavigate();
  const { spaces, currentSpace, setCurrentSpace, newSpace, editSpace } = useContent();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = spaces.find((space) => space.slug === currentSpace);

  return (
    <div className="space-switcher" ref={ref}>
      <button
        type="button"
        className="space-switcher__button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="space-switcher__icon">
          <EmojiGlyph value={active?.icon ?? '◆'} />
        </span>
        <span className="space-switcher__name">{active?.name ?? 'tablinum'}</span>
        <ChevronDown size={12} className="space-switcher__caret" />
      </button>

      {open ? (
        <div className="space-switcher__menu" role="menu">
          {spaces.map((space) => (
            <button
              key={space.slug}
              type="button"
              role="menuitem"
              className={
                space.slug === currentSpace ? 'space-switcher__item space-switcher__item--active' : 'space-switcher__item'
              }
              onClick={() => {
                setOpen(false);
                setCurrentSpace(space.slug);
                const first = space.tree[0];
                navigate(pageHref(first ? first.path : space.slug));
              }}
            >
              <span className="space-switcher__icon">
                <EmojiGlyph value={space.icon ?? '◆'} />
              </span>
              <span className="space-switcher__name">{space.name}</span>
            </button>
          ))}
          <div className="space-switcher__divider" />
          {active ? (
            <button
              type="button"
              role="menuitem"
              className="space-switcher__item"
              onClick={() => {
                setOpen(false);
                editSpace(active.slug);
              }}
            >
              <span className="space-switcher__icon">
                <Pencil size={12} />
              </span>
              <span className="space-switcher__name">Edit space</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="space-switcher__item"
            onClick={() => {
              setOpen(false);
              newSpace();
            }}
          >
            <span className="space-switcher__icon">
              <Plus size={12} />
            </span>
            <span className="space-switcher__name">New space</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
