import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLogin } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/toast';
import './login.css';

/** Shown in place of the whole shell once a request comes back 401. */
export function LoginRoute() {
  const login = useLogin();
  const { markAuthenticated } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    login.mutate(
      { password },
      {
        onSuccess: () => {
          setPassword('');
          markAuthenticated();
        },
        onError: (cause) => setError(describeError(cause, 'That password was not accepted.')),
      },
    );
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit}>
        <div className="login__brand">gitdocs</div>
        <p className="login__lede">Sign in to edit your docs.</p>

        <label className="field">
          <span className="field__label">Password</span>
          <input
            ref={inputRef}
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? <p className="login__error">{error}</p> : null}

        <button type="submit" className="btn btn--primary login__submit" disabled={login.isPending || password.length === 0}>
          {login.isPending ? <span className="spinner" /> : null}
          Sign in
        </button>

        <p className="login__note">
          Agents authenticate with <code>Authorization: Bearer &lt;token&gt;</code> instead.
        </p>
      </form>
    </div>
  );
}
