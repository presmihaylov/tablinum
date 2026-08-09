import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MIN_PASSWORD_LENGTH } from '@tablinum/shared';
import { useInvitePreview, useRegister } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/toast';
import './login.css';

/** The screen an invited person lands on. It runs before any credential exists. */
export function InviteRoute() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { markAuthenticated } = useAuth();
  const preview = useInvitePreview(token);
  const register = useRegister();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pinned = preview.data?.email ?? null;
  const needsEmail = preview.isSuccess && pinned === null;

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    register.mutate(
      {
        token: token ?? '',
        name: name.trim(),
        password,
        ...(needsEmail ? { email: email.trim() } : {}),
      },
      {
        onSuccess: () => {
          markAuthenticated();
          void navigate('/', { replace: true });
        },
        onError: (cause) => setError(describeError(cause, 'Could not create that account.')),
      },
    );
  };

  const canSubmit =
    name.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    (!needsEmail || email.includes('@'));

  if (preview.isPending) {
    return (
      <div className="login">
        <div className="login__card">
          <div className="login__brand">tablinum</div>
          <p className="login__lede">Checking the link...</p>
        </div>
      </div>
    );
  }

  if (preview.isError) {
    return (
      <div className="login">
        <div className="login__card">
          <div className="login__brand">tablinum</div>
          <p className="login__lede">This invite link is not valid any more.</p>
          <p className="login__note">Ask whoever sent it for a new one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit}>
        <div className="login__brand">tablinum</div>
        <p className="login__lede">
          {preview.data?.invitedBy === null || preview.data === undefined
            ? 'You are invited to these docs.'
            : `${preview.data.invitedBy} invited you to these docs.`}
        </p>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={pinned ?? email}
            readOnly={pinned !== null}
            disabled={pinned !== null}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="input"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <p className="login__note">At least {MIN_PASSWORD_LENGTH} characters.</p>

        {error === null ? null : <p className="login__error">{error}</p>}

        <button
          type="submit"
          className="btn btn--primary login__submit"
          disabled={register.isPending || !canSubmit}
        >
          {register.isPending ? <span className="spinner" /> : null}
          Join
        </button>
      </form>
    </div>
  );
}
