import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '@gitdocs/shared';
import { useLogin, useSetup } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/toast';
import './login.css';

/** Shown in place of the whole shell once a request comes back 401. */
export function LoginRoute() {
  const { markAuthenticated, hasAccounts, setupRequired, passwordLogin, ready } = useAuth();
  const login = useLogin();
  const setup = useSetup();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, [ready, shared]);

  // An unclaimed server that answers this screen at all is an open one: claim it here.
  const claiming = setupRequired && !hasAccounts;
  // Only ask for an address once the server has accounts. Otherwise there is nothing to match.
  const byEmail = hasAccounts && !shared;

  const done = (): void => {
    setPassword('');
    markAuthenticated();
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);

    if (claiming) {
      setup.mutate(
        { email: email.trim(), name: name.trim(), password },
        { onSuccess: done, onError: (cause) => setError(describeError(cause, 'Could not create that account.')) },
      );
      return;
    }

    login.mutate(
      byEmail ? { email: email.trim(), password } : { password },
      {
        onSuccess: done,
        onError: (cause) => setError(describeError(cause, 'That did not get you in.')),
      },
    );
  };

  const pending = login.isPending || setup.isPending;
  const canSubmit = claiming
    ? email.includes('@') && name.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH
    : password.length > 0 && (!byEmail || email.trim().length > 0);

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit}>
        <div className="login__brand">gitdocs</div>
        <p className="login__lede">
          {claiming ? 'Create the first account for this server.' : 'Sign in to edit your docs.'}
        </p>

        {claiming || byEmail ? (
          <label className="field">
            <span className="field__label">Email</span>
            <input
              ref={firstRef}
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        ) : null}

        {claiming ? (
          <label className="field">
            <span className="field__label">Your name</span>
            <input
              className="input"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : null}

        <label className="field">
          <span className="field__label">Password</span>
          <input
            ref={claiming || byEmail ? undefined : firstRef}
            className="input"
            type="password"
            value={password}
            autoComplete={claiming ? 'new-password' : 'current-password'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? <p className="login__error">{error}</p> : null}

        <button type="submit" className="btn btn--primary login__submit" disabled={pending || !canSubmit}>
          {pending ? <span className="spinner" /> : null}
          {claiming ? 'Create account' : 'Sign in'}
        </button>

        {hasAccounts && passwordLogin && !claiming ? (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              setShared((prev) => !prev);
              setError(null);
            }}
          >
            {shared ? 'Sign in with your account' : 'Use the shared password'}
          </button>
        ) : null}

        <p className="login__note">
          Agents authenticate with <code>Authorization: Bearer &lt;token&gt;</code> instead.
        </p>
      </form>
    </div>
  );
}
