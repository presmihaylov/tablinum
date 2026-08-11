import { useState } from 'react';
import {
  DEFAULT_INVITE_DAYS,
  HANDLE_HINT,
  isHandle,
  normalizeHandle,
  type Account,
  type AccountRole,
  type Invite,
} from '@tablinum/shared';
import { useChangeUserHandle, useUserHandlePreview } from '../../api/handles';
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
import { describeReservation, describeRewrite, holderNamed } from './handleCost';
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
  // Whose handle is open for editing. One at a time: a preview reads every page of every open
  // workspace, so a roster that asked for one per row would crawl the content once per person.
  const [renaming, setRenaming] = useState<string | null>(null);

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
          <div key={user.id}>
            <div className="people-row">
              <Avatar person={user} size={26} />
              <div className="people-row__who">
                <div className="people-row__name">
                  {user.name}
                  {user.id === me?.id ? ' (you)' : ''}
                </div>
                <div className="people-row__email">
                  {user.email} · @{user.handle}
                </div>
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
                className="btn btn--outline"
                onClick={() => setRenaming(renaming === user.id ? null : user.id)}
                aria-label={`Change the handle of ${user.name}`}
              >
                Handle
              </button>
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
            {renaming === user.id ? (
              <HandleEditor user={user} onAsk={setConfirm} onDone={() => setRenaming(null)} />
            ) : null}
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

interface HandleEditorProps {
  user: Account;
  onAsk: (request: ConfirmRequest) => void;
  onDone: () => void;
}

/**
 * Rename somebody else, having been told what it costs first.
 *
 * The sweep behind this rewrites pages and comments other people wrote and committed, and the
 * person who holds the handle is not here to agree to it. So the admin sees the same count and
 * agrees to the same sentence a person renaming themselves does.
 */
function HandleEditor({ user, onAsk, onDone }: HandleEditorProps) {
  const toast = useToast();
  const preview = useUserHandlePreview(user.id);
  const changeHandle = useChangeUserHandle();
  const [handle, setHandle] = useState(user.handle);
  const [error, setError] = useState<string | null>(null);

  const holder = holderNamed(user.name);
  const wanted = normalizeHandle(handle);
  const changeableAt = preview.data?.changeableAt ?? null;
  const current = preview.data?.handle ?? user.handle;

  const submit = (next: string): void => {
    changeHandle.mutate(
      { id: user.id, body: { handle: next } },
      {
        onSuccess: (data) => {
          const left = data.rewritten.skipped;
          // Those pages keep the old handle, which is still reserved, so they still name the
          // right person. Saying so is the point of counting them.
          const note =
            left === 0 ? '' : `. ${left} ${left === 1 ? 'page' : 'pages'} kept the old one`;
          toast.push(`${user.name} is now @${data.user.handle}${note}`, 'success');
          onDone();
        },
        onError: (cause) => setError(describeError(cause, 'Could not change that handle.')),
      },
    );
  };

  const ask = (): void => {
    if (wanted === current) return;
    if (!isHandle(wanted)) {
      setError(HANDLE_HINT);
      return;
    }

    setError(null);
    onAsk({
      title: `Change the handle of ${user.name} to @${wanted}?`,
      message: `${describeRewrite(preview.data, holder)} ${describeReservation(current, holder)}`,
      confirmLabel: 'Rewrite the mentions',
      onConfirm: () => submit(wanted),
    });
  };

  return (
    <div className="people-handle">
      <label className="field">
        <span className="field__label">Handle of {user.name}</span>
        <input
          className="input"
          value={handle}
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => setHandle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            ask();
          }}
        />
      </label>
      <p className="account-form__note">
        {describeRewrite(preview.data, holder)}
        {changeableAt === null
          ? ''
          : ` ${user.name} changed it recently, so the next change is possible after ${new Date(changeableAt).toLocaleString()}.`}
      </p>
      {error === null ? null : <p className="account-form__error">{error}</p>}
      <button
        type="button"
        className="btn btn--primary"
        onClick={ask}
        disabled={changeHandle.isPending || changeableAt !== null || wanted === current}
      >
        Change handle
      </button>
    </div>
  );
}
