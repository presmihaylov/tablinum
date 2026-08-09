import { useState } from 'react';
import type { WorkspaceRole } from '@tablinum/shared';
import { api } from '../../api/client';
import {
  useAddWorkspaceMember,
  useDeleteWorkspace,
  useRemoveWorkspaceMember,
  useSetWorkspaceMemberRole,
  useUpdateWorkspace,
  useUsers,
  useWorkspaceMembers,
} from '../../api/hooks';
import { describeError, useToast } from '../../lib/toast';
import { useWorkspace } from '../../lib/workspaces';
import { Avatar } from '../Account/Avatar';
import { ConfirmDialog, type ConfirmRequest } from '../ui/ConfirmDialog';
import { EmojiGlyph } from '../ui/EmojiGlyph';
import { Download, Trash } from '../ui/Icon';
import { Modal } from '../ui/Overlay';
import { SpaceDialog, type SpaceDialogRequest } from '../ui/SpaceDialog';
import './workspace.css';

interface WorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Rename the workspace, say who is in it, take a copy of it or throw it away. */
export function WorkspaceDialog({ open, onClose }: WorkspaceDialogProps) {
  const { workspaces, current, switchTo } = useWorkspace();
  const toast = useToast();
  const members = useWorkspaceMembers(open && current !== null ? current.id : null);
  const users = useUsers(open);
  const updateWorkspace = useUpdateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const addMember = useAddWorkspaceMember();
  const setRole = useSetWorkspaceMemberRole();
  const removeMember = useRemoveWorkspaceMember();

  const [rename, setRename] = useState<SpaceDialogRequest | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [add, setAdd] = useState('');

  if (!open || current === null) return null;

  const inWorkspace = new Set((members.data?.members ?? []).map((one) => one.account.id));
  const outsiders = (users.data?.users ?? []).filter((user) => !inWorkspace.has(user.id));

  const edit = (): void =>
    setRename({
      title: 'Workspace',
      nameLabel: 'Workspace name',
      initialName: current.name,
      initialIcon: current.icon ?? null,
      onConfirm: ({ name, icon }) =>
        updateWorkspace.mutate(
          { id: current.id, patch: { name, icon } },
          { onError: (cause) => setError(describeError(cause, 'Could not save that name.')) },
        ),
    });

  const remove = (): void =>
    setConfirm({
      title: `Delete ${current.name}?`,
      message:
        'tablinum forgets the workspace and everybody in it. The git repository stays on disk, so export it first if you want the pages.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () =>
        deleteWorkspace.mutate(current.id, {
          onSuccess: () => {
            onClose();
            const next = workspaces.find((one) => one.id !== current.id);
            if (next !== undefined) switchTo(next.slug);
          },
          onError: (cause) => setError(describeError(cause, 'Could not delete that workspace.')),
        }),
    });

  const invite = (): void => {
    if (add.length === 0) return;
    addMember.mutate(
      { id: current.id, userId: add },
      {
        onSuccess: () => setAdd(''),
        onError: (cause) => setError(describeError(cause, 'Could not add that person.')),
      },
    );
  };

  return (
    <>
      <Modal
        open
        title={current.name}
        onClose={onClose}
        width="34rem"
        footer={
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Done
          </button>
        }
      >
        <div className="workspace-head">
          <span className="workspace-head__mark">
            <EmojiGlyph value={current.icon ?? '◆'} />
          </span>
          <div className="workspace-head__who">
            <div className="workspace-head__name">{current.name}</div>
            <div className="workspace-head__slug">{current.slug}</div>
          </div>
          <button type="button" className="btn btn--outline" onClick={edit}>
            Edit
          </button>
        </div>

        {error === null ? null : <p className="account-form__error">{error}</p>}

        <div className="account-section">
          <div className="account-section__title">People</div>
          {(members.data?.members ?? []).map((member) => (
            <div className="people-row" key={member.account.id}>
              <Avatar person={member.account} size={26} />
              <div className="people-row__who">
                <div className="people-row__name">{member.account.name}</div>
                <div className="people-row__email">{member.account.email}</div>
              </div>
              <select
                className="input"
                value={member.role}
                aria-label={`Role of ${member.account.name}`}
                onChange={(event) => {
                  const role: WorkspaceRole = event.target.value === 'admin' ? 'admin' : 'member';
                  setRole.mutate({ id: current.id, userId: member.account.id, role });
                }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="button"
                className="btn btn--icon"
                aria-label={`Remove ${member.account.name}`}
                title={`Remove ${member.account.name}`}
                onClick={() => removeMember.mutate({ id: current.id, userId: member.account.id })}
              >
                <Trash />
              </button>
            </div>
          ))}
          {members.data?.members.length === 0 ? (
            <p className="account-form__note">Everybody on this server can open this workspace.</p>
          ) : null}
        </div>

        {outsiders.length === 0 ? null : (
          <div className="account-form__row">
            <select
              className="input"
              value={add}
              aria-label="Add somebody"
              onChange={(event) => setAdd(event.target.value)}
            >
              <option value="">Add somebody…</option>
              {outsiders.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--primary"
              onClick={invite}
              disabled={add.length === 0 || addMember.isPending}
            >
              Add
            </button>
          </div>
        )}

        <div className="account-section">
          <div className="account-section__title">The whole workspace</div>
          <div className="workspace-actions">
            <a
              className="btn btn--outline"
              href={api.workspaceExportUrl(current.id)}
              download={`${current.slug}.zip`}
              onClick={() => toast.push('Building the archive…')}
            >
              <Download />
              Export as a zip
            </a>
            <button type="button" className="btn btn--danger" onClick={remove}>
              <Trash />
              Delete workspace
            </button>
          </div>
          <p className="account-form__note">
            The zip holds the git repository, so every page and its history travel with it. Import it
            on any tablinum to get the workspace back.
          </p>
        </div>
      </Modal>

      <SpaceDialog request={rename} onClose={() => setRename(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
