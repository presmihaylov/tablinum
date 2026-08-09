import { useRef, useState, type ChangeEvent } from 'react';
import { AVATAR_MIME_TYPES, MIN_PASSWORD_LENGTH, type Account } from '@tablinum/shared';
import {
  useChangePassword,
  useConnectSlack,
  useDisconnectSlack,
  useRemoveAvatar,
  useSlackState,
  useUpdateMe,
  useUploadAvatar,
} from '../../api/hooks';
import { describeError, useToast } from '../../lib/toast';
import { Modal } from '../ui/Overlay';
import { Avatar } from './Avatar';
import './account.css';

interface ProfileDialogProps {
  user: Account;
  open: boolean;
  onClose: () => void;
}

/** Your own account: the name other people see, your picture and your password. */
export function ProfileDialog({ user, open, onClose }: ProfileDialogProps) {
  const toast = useToast();
  const updateMe = useUpdateMe();
  const uploadAvatar = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();
  const changePassword = useChangePassword();

  const slack = useSlackState(open);
  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();

  const [name, setName] = useState(user.name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [slackId, setSlackId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const saveName = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === user.name) return;
    updateMe.mutate(
      { name: trimmed },
      {
        onSuccess: () => toast.push('Name saved', 'success'),
        onError: (cause) => setError(describeError(cause, 'Could not save that name.')),
      },
    );
  };

  const pickAvatar = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    uploadAvatar.mutate(file, {
      onSuccess: () => toast.push('Picture updated', 'success'),
      onError: (cause) => setError(describeError(cause, 'Could not use that image.')),
    });
  };

  const submitPassword = (): void => {
    setError(null);
    changePassword.mutate(
      { current, next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          toast.push('Password changed', 'success');
        },
        onError: (cause) => setError(describeError(cause, 'Could not change the password.')),
      },
    );
  };

  const submitSlack = (): void => {
    setError(null);
    const trimmed = slackId.trim();
    connectSlack.mutate(trimmed.length === 0 ? {} : { slackUserId: trimmed }, {
      onSuccess: () => {
        setSlackId('');
        toast.push('Slack connected', 'success');
      },
      onError: (cause) => setError(describeError(cause, 'Could not connect Slack.')),
    });
  };

  return (
    <Modal
      open={open}
      title="Your account"
      onClose={onClose}
      width="26rem"
      footer={
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="account-form">
        <div className="account-form__row">
          <Avatar person={user} size={48} />
          <div className="account-form">
            <div className="account-form__row">
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploadAvatar.isPending}
              >
                Upload a picture
              </button>
              {user.avatarRev === null ? null : (
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => removeAvatar.mutate()}
                  disabled={removeAvatar.isPending}
                >
                  Remove
                </button>
              )}
            </div>
            <p className="account-form__note">PNG, JPEG, WebP or GIF, up to 512 KB.</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept={AVATAR_MIME_TYPES.join(',')}
            onChange={pickAvatar}
          />
        </div>

        <label className="field">
          <span className="field__label">Display name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              saveName();
            }}
          />
        </label>

        <label className="field">
          <span className="field__label">Email</span>
          <input className="input" value={user.email} readOnly disabled />
        </label>

        <label className="field">
          <span className="field__label">Handle</span>
          <input className="input" value={`@${user.handle}`} readOnly disabled />
          <p className="account-form__note">Other people write this to mention you on a page.</p>
        </label>

        <div className="account-section">
          <div className="account-section__title">Slack notifications</div>
          <SlackSection
            configured={slack.data?.configured ?? false}
            connected={slack.data?.connected ?? false}
            slackUserId={slack.data?.slackUserId ?? null}
            value={slackId}
            busy={connectSlack.isPending || disconnectSlack.isPending}
            onChange={setSlackId}
            onConnect={submitSlack}
            onDisconnect={() =>
              disconnectSlack.mutate(undefined, {
                onSuccess: () => toast.push('Slack disconnected', 'success'),
                onError: (cause) => setError(describeError(cause, 'Could not disconnect Slack.')),
              })
            }
          />
        </div>

        <div className="account-section">
          <div className="account-section__title">Change your password</div>
          <div className="account-form">
            <label className="field">
              <span className="field__label">Current password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">New password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            </label>
            <p className="account-form__note">
              At least {MIN_PASSWORD_LENGTH} characters. Every other browser is signed out.
            </p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={submitPassword}
              disabled={
                changePassword.isPending || current.length === 0 || next.length < MIN_PASSWORD_LENGTH
              }
            >
              Change password
            </button>
          </div>
        </div>

        {error === null ? null : <p className="account-form__error">{error}</p>}
      </div>
    </Modal>
  );
}

interface SlackSectionProps {
  configured: boolean;
  connected: boolean;
  slackUserId: string | null;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

function SlackSection(props: SlackSectionProps) {
  if (!props.configured) {
    return (
      <p className="account-form__note">
        This server has no Slack bot token. An admin sets TABLINUM_SLACK_BOT_TOKEN to turn on
        notifications.
      </p>
    );
  }

  if (props.connected) {
    return (
      <div className="account-form">
        <p className="account-form__note">
          Connected as {props.slackUserId}. You get a direct message when somebody mentions you.
        </p>
        <button
          type="button"
          className="btn btn--outline"
          onClick={props.onDisconnect}
          disabled={props.busy}
        >
          Disconnect Slack
        </button>
      </div>
    );
  }

  return (
    <div className="account-form">
      <label className="field">
        <span className="field__label">Slack member id (optional)</span>
        <input
          className="input"
          placeholder="U01ABCDEF"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </label>
      <p className="account-form__note">
        Leave it empty to match your Slack account by email address.
      </p>
      <button
        type="button"
        className="btn btn--primary"
        onClick={props.onConnect}
        disabled={props.busy}
      >
        Connect Slack
      </button>
    </div>
  );
}
