import { useState } from 'react';
import { DEFAULT_INVITE_DAYS, type Account, type AccountRole, type Invite } from '@tablinum/shared';
import {
  useCreateInvite,
  useDeleteUser,
  useInvites,
  useRevokeInvite,
  useUpdateUser,
  useUsers,
} from '../../api/accounts';
import { absoluteTime } from '../../lib/format';
import { describeError, useToast } from '../../lib/toast';
import { ConfirmDialog, type ConfirmRequest } from '../ui/ConfirmDialog';
import { Copy, Trash } from '../ui/Icon';
import { Avatar } from './Avatar';
import './account.css';

interface PeoplePanelProps {
  me: Account | null;
}

/** An invite is still worth showing while it is unused and inside its lifetime. */
function isPending(invite: Invite): boolean {
  return !invite.revoked && invite.acceptedBy === null && Date.parse(invite.expires) > Date.now();
}

/** Everyone with an account, plus the links that have been sent but not used.
 * It draws sections only: the workspace page it sits on owns the form around them. */
export function PeoplePanel({ me }: PeoplePanelProps) {
  const toast = useToast();
  const users = useUsers(true);
  const invites = useInvites(true);
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AccountRole>('member');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const invite = (): void => {
    setError(null);
    const trimmed = email.trim();
    createInvite.mutate(
      { role, ...(trimmed.length > 0 ? { email: trimmed } : {}) },
      {
        onSuccess: (result) => {
          setEmail('');
          setLink(result.url);
        },
        onError: (cause) => setError(describeError(cause, 'Could not create that invite.')),
      },
    );
  };

  const copy = (url: string): void => {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.push('Invite link copied', 'success'))
      .catch(() => toast.push('Could not copy the link', 'error'));
  };

  const setRoleOf = (user: Account, next: AccountRole): void => {
    updateUser.mutate(
      { id: user.id, patch: { role: next } },
      { onError: (cause) => setError(describeError(cause, 'Could not change that role.')) },
    );
  };

  const remove = (user: Account): void =>
    setConfirm({
      title: `Remove ${user.name}?`,
      message: 'They lose access at once. Their pages stay exactly where they are.',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () =>
        deleteUser.mutate(user.id, {
          onError: (cause) => setError(describeError(cause, 'Could not remove that account.')),
        }),
    });

  const pending = (invites.data?.invites ?? []).filter(isPending);

  return (
    <>
      <div className="account-section account-section--stack">
        <div className="account-section__title">Invite somebody</div>
        <div className="account-form__row">
          <input
            className="input"
            placeholder="name@example.com (optional)"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              invite();
            }}
          />
          <select
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'member')}
            aria-label="Role"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="button"
            className="btn btn--primary"
            onClick={invite}
            disabled={createInvite.isPending}
          >
            Create link
          </button>
        </div>
        <p className="account-form__note">
          Without an address anybody with the link can join. The link lasts {DEFAULT_INVITE_DAYS} days.
        </p>

        {link === null ? null : (
          <div className="invite-link">
            <span className="invite-link__url">{link}</span>
            <button type="button" className="btn btn--icon" onClick={() => copy(link)} title="Copy the link">
              <Copy />
            </button>
          </div>
        )}

        {error === null ? null : <p className="account-form__error">{error}</p>}
      </div>

      <section className="account-section" aria-label="Accounts">
        <div className="account-section__title">Accounts</div>
        {(users.data?.users ?? []).map((user) => (
          <div className="people-row" key={user.id}>
            <Avatar person={user} size={26} />
            <div className="people-row__who">
              <div className="people-row__name">
                {user.name}
                {user.id === me?.id ? ' (you)' : ''}
              </div>
              <div className="people-row__email">{user.email}</div>
            </div>
            <select
              className="input"
              value={user.role}
              onChange={(event) => setRoleOf(user, event.target.value === 'admin' ? 'admin' : 'member')}
              aria-label={`Role of ${user.name}`}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => remove(user)}
              disabled={user.id === me?.id}
              title={user.id === me?.id ? 'You cannot remove yourself' : `Remove ${user.name}`}
              aria-label={`Remove ${user.name}`}
            >
              <Trash />
            </button>
          </div>
        ))}
      </section>

      {pending.length === 0 ? null : (
        <section className="account-section" aria-label="Invites waiting">
          <div className="account-section__title">Invites waiting</div>
          {pending.map((item) => (
            <div className="people-row" key={item.id}>
              <div className="people-row__who">
                <div className="people-row__name">{item.email ?? 'Anyone with the link'}</div>
                <div className="people-row__email">
                  {item.role} · expires {absoluteTime(item.expires)}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--icon"
                onClick={() => revokeInvite.mutate(item.id)}
                title="Revoke this invite"
                aria-label="Revoke this invite"
              >
                <Trash />
              </button>
            </div>
          ))}
        </section>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
