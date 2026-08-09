import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH, workspaceSlugOf } from '@gitdocs/shared';
import { useLogin, useSetup, useUpdateWorkspace, useWorkspaces } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/toast';
import './login.css';

/**
 * Shown in place of the whole shell whenever nobody is signed in. A fresh server has no account
 * at all, so the first visitor creates one here and then names the workspace it lands in.
 */
export function LoginRoute() {
  const { setupRequired } = useAuth();
  const [claimed, setClaimed] = useState(false);

  if (claimed) return <FirstWorkspaceForm />;
  return <SignInForm claiming={setupRequired} onClaimed={() => setClaimed(true)} />;
}

function SignInForm({ claiming, onClaimed }: { claiming: boolean; onClaimed: () => void }) {
  const { markAuthenticated, ready } = useAuth();
  const login = useLogin();
  const setup = useSetup();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, [ready]);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    const failed = (fallback: string) => (cause: unknown) => setError(describeError(cause, fallback));

    if (claiming) {
      setup.mutate(
        { email: email.trim(), name: name.trim(), password },
        { onSuccess: onClaimed, onError: failed('Could not create that account.') },
      );
      return;
    }

    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: () => {
          setPassword('');
          markAuthenticated();
        },
        onError: failed('That did not get you in.'),
      },
    );
  };

  const pending = login.isPending || setup.isPending;
  const canSubmit = claiming
    ? email.includes('@') && name.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH
    : email.trim().length > 0 && password.length > 0;

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit}>
        <div className="login__brand">gitdocs</div>
        <p className="login__lede">
          {claiming
            ? 'Nobody has claimed this server yet. Create your account to start.'
            : 'Sign in to edit your docs.'}
        </p>

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

        <p className="login__note">
          {claiming
            ? 'You become the admin, and you invite everybody else by link.'
            : 'No account? Ask an admin for an invite link.'}
        </p>
      </form>
    </div>
  );
}

/** The second step of a first run: the new admin names the workspace the server started with. */
function FirstWorkspaceForm() {
  const { markAuthenticated } = useAuth();
  const workspaces = useWorkspaces();
  const update = useUpdateWorkspace();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [workspaces.isSuccess]);

  const first = workspaces.data?.workspaces[0] ?? null;

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    if (first === null) {
      markAuthenticated();
      return;
    }
    update.mutate(
      { id: first.id, patch: { name: name.trim(), slug: workspaceSlugOf(name.trim()) } },
      {
        onSuccess: () => markAuthenticated(),
        onError: (cause) => setError(describeError(cause, 'Could not name that workspace.')),
      },
    );
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit}>
        <div className="login__brand">gitdocs</div>
        <p className="login__lede">Name your first workspace. You can add more at any time.</p>

        <label className="field">
          <span className="field__label">Workspace name</span>
          <input
            ref={inputRef}
            className="input"
            placeholder="Acme docs"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        {error ? <p className="login__error">{error}</p> : null}

        <button
          type="submit"
          className="btn btn--primary login__submit"
          disabled={update.isPending || name.trim().length === 0}
        >
          {update.isPending ? <span className="spinner" /> : null}
          Create workspace
        </button>

        <button type="button" className="btn btn--outline" onClick={() => markAuthenticated()}>
          Skip for now
        </button>
      </form>
    </div>
  );
}
