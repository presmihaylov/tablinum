import { useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@gitdocs/shared';
import { useSetup } from '../../api/hooks';
import { describeError, useToast } from '../../lib/toast';
import { Modal } from '../ui/Overlay';
import './account.css';

interface SetupDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Claim a server that still has no accounts. Only somebody who can already reach the API
 * sees this, so an open server closes the moment the first admin exists.
 */
export function SetupDialog({ open, onClose }: SetupDialogProps) {
  const toast = useToast();
  const setup = useSetup();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ready = email.includes('@') && name.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH;

  const submit = (): void => {
    setError(null);
    setup.mutate(
      { email: email.trim(), name: name.trim(), password },
      {
        onSuccess: () => {
          setPassword('');
          toast.push('Your admin account is ready', 'success');
          onClose();
        },
        onError: (cause) => setError(describeError(cause, 'Could not create that account.')),
      },
    );
  };

  return (
    <Modal
      open={open}
      title="Create your account"
      onClose={onClose}
      width="24rem"
      footer={
        <>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Later
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!ready || setup.isPending}>
            Create account
          </button>
        </>
      }
    >
      <div className="account-form">
        <p className="account-form__note">
          You become the admin. After this, everybody else joins through an invite link.
        </p>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
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
        <p className="account-form__note">At least {MIN_PASSWORD_LENGTH} characters.</p>

        {error === null ? null : <p className="account-form__error">{error}</p>}
      </div>
    </Modal>
  );
}
