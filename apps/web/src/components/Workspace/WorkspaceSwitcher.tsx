import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Workspace } from '@tablinum/shared';
import { useCreateWorkspace } from '../../api/accounts';
import { describeError, useToast } from '../../lib/toast';
import { useWorkspace } from '../../lib/workspaces';
import { EmojiGlyph } from '../ui/EmojiGlyph';
import { ChevronDown, Plus, Settings } from '../ui/Icon';
import { SpaceDialog, type SpaceDialogRequest } from '../ui/SpaceDialog';
import './workspace.css';

/** The top level of the sidebar: which workspace this tab is in, and how to leave it. */
export function WorkspaceSwitcher() {
  const { workspaces, current, switchTo } = useWorkspace();
  const createWorkspace = useCreateWorkspace();
  const navigate = useNavigate();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<SpaceDialogRequest | null>(null);
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

  const create = (): void =>
    setDialog({
      title: 'New workspace',
      nameLabel: 'Workspace name',
      confirmLabel: 'Create',
      onConfirm: ({ name, icon }) =>
        createWorkspace.mutate(
          { name, ...(icon === null ? {} : { icon }) },
          {
            onSuccess: (result) => {
              toast.push(`${result.workspace.name} is ready`, 'success');
              switchTo(result.workspace.slug);
            },
            onError: (cause) => toast.push(describeError(cause, 'Could not create that workspace.'), 'error'),
          },
        ),
    });

  return (
    <div className="workspace-switcher" ref={ref}>
      <button
        type="button"
        className="workspace-switcher__button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Workspace"
      >
        <span className="workspace-switcher__mark">
          <EmojiGlyph value={current?.icon ?? initialOf(current)} />
        </span>
        <span className="workspace-switcher__name">{current?.name ?? 'tablinum'}</span>
        <ChevronDown size={12} className="workspace-switcher__caret" />
      </button>

      {open ? (
        <div className="workspace-switcher__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="workspace-switcher__item"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
          >
            <span className="workspace-switcher__mark">
              <Settings size={12} />
            </span>
            <span className="workspace-switcher__name">Settings</span>
          </button>

          <div className="workspace-switcher__divider" />

          {workspaces.map((one) => (
            <button
              key={one.id}
              type="button"
              role="menuitem"
              className={
                one.id === current?.id
                  ? 'workspace-switcher__item workspace-switcher__item--active'
                  : 'workspace-switcher__item'
              }
              onClick={() => {
                setOpen(false);
                switchTo(one.slug);
              }}
            >
              <span className="workspace-switcher__mark">
                <EmojiGlyph value={one.icon ?? initialOf(one)} />
              </span>
              <span className="workspace-switcher__name">{one.name}</span>
            </button>
          ))}

          <div className="workspace-switcher__divider" />

          <button
            type="button"
            role="menuitem"
            className="workspace-switcher__item"
            onClick={() => {
              setOpen(false);
              create();
            }}
          >
            <span className="workspace-switcher__mark">
              <Plus size={12} />
            </span>
            <span className="workspace-switcher__name">New workspace</span>
          </button>
        </div>
      ) : null}

      <SpaceDialog request={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/** A workspace with no icon shows its first letter, which is enough to tell two apart. */
function initialOf(workspace: Workspace | null): string {
  return workspace === null ? '◆' : (workspace.name.trim()[0] ?? '◆').toUpperCase();
}
