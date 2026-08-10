import { useRef, useState, type ChangeEvent } from 'react';
import {
  AVATAR_MIME_TYPES,
  MAX_IDENTITY_LENGTH,
  type Agent,
  type AgentTokenResponse,
} from '@tablinum/shared';
import {
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  useRemoveAgentAvatar,
  useRotateAgentToken,
  useUpdateAgent,
  useUploadAgentAvatar,
} from '../../api/hooks';
import { relativeTime } from '../../lib/format';
import { describeError, useToast } from '../../lib/toast';
import { ConfirmDialog, type ConfirmRequest } from '../ui/ConfirmDialog';
import { Copy, Pencil, Sync, Trash } from '../ui/Icon';
import { Avatar } from './Avatar';
import './account.css';

const PLACEHOLDER = [
  'Who is this agent and how should it write?',
  'For example: You look after the engineering runbooks.',
  'Keep steps numbered and never delete a page without being asked.',
].join(' ');

/** The name and the identity of the agent the admin is editing right now. */
interface Draft {
  name: string;
  identity: string;
}

/** Agents: the non-human writers, their identity, and the token each one connects with. */
export function AgentsPanel() {
  const toast = useToast();
  const agents = useAgents(true);
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const rotateToken = useRotateAgentToken();
  const uploadAvatar = useUploadAgentAvatar();
  const removeAvatar = useRemoveAgentAvatar();

  const [name, setName] = useState('');
  const [identity, setIdentity] = useState('');
  const [secret, setSecret] = useState<AgentTokenResponse | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', identity: '' });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const copy = (value: string, what: string): void => {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.push(`${what} copied`, 'success'))
      .catch(() => toast.push(`Could not copy the ${what.toLowerCase()}`, 'error'));
  };

  const add = (): void => {
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Give the agent a name.');
      return;
    }
    createAgent.mutate(
      { name: trimmed, identity: identity.trim() },
      {
        onSuccess: (result) => {
          setName('');
          setIdentity('');
          setSecret(result);
        },
        onError: (cause) => setError(describeError(cause, 'Could not add that agent.')),
      },
    );
  };

  const startEdit = (agent: Agent): void => {
    setError(null);
    setEditing(agent.id);
    setDraft({ name: agent.name, identity: agent.identity });
  };

  const save = (agent: Agent): void => {
    const next = { name: draft.name.trim(), identity: draft.identity.trim() };
    if (next.name.length === 0) {
      setError('Give the agent a name.');
      return;
    }
    if (next.name === agent.name && next.identity === agent.identity) {
      setEditing(null);
      return;
    }
    updateAgent.mutate(
      { id: agent.id, patch: next },
      {
        onSuccess: () => setEditing(null),
        onError: (cause) => setError(describeError(cause, 'Could not save that agent.')),
      },
    );
  };

  const pickAvatar = (agent: Agent, event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    uploadAvatar.mutate(
      { id: agent.id, file },
      {
        onSuccess: () => toast.push(`Picture updated for ${agent.name}`, 'success'),
        onError: (cause) => setError(describeError(cause, 'Could not use that image.')),
      },
    );
  };

  const rotate = (agent: Agent): void =>
    setConfirm({
      title: `Issue a new token for ${agent.name}?`,
      message: 'The token it uses today stops working at once. Anything running with it disconnects.',
      confirmLabel: 'New token',
      onConfirm: () =>
        rotateToken.mutate(agent.id, {
          onSuccess: (result) => setSecret(result),
          onError: (cause) => setError(describeError(cause, 'Could not issue a new token.')),
        }),
    });

  const remove = (agent: Agent): void =>
    setConfirm({
      title: `Delete ${agent.name}?`,
      message: 'Its token stops working at once. The pages it wrote stay exactly where they are.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () =>
        deleteAgent.mutate(agent.id, {
          onError: (cause) => setError(describeError(cause, 'Could not delete that agent.')),
        }),
    });

  const list = agents.data?.agents ?? [];

  return (
    <>
      <div className="account-form">
        <div className="account-section__title">Add an agent</div>
        <div className="account-form__row">
          <input
            className="input"
            placeholder="Doc Bot"
            aria-label="Agent name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" className="btn btn--primary" onClick={add} disabled={createAgent.isPending}>
            Add agent
          </button>
        </div>
        <textarea
          className="input agent-identity"
          placeholder={PLACEHOLDER}
          aria-label="Agent identity"
          maxLength={MAX_IDENTITY_LENGTH}
          value={identity}
          onChange={(event) => setIdentity(event.target.value)}
        />
        <p className="account-form__note">
          The identity is the first thing the agent reads when it connects. Write it as instructions to
          the agent itself.
        </p>

        {secret === null ? null : (
          <div className="agent-secret">
            <div className="agent-secret__label">
              Copy this token now. It is shown once and never again.
            </div>
            <div className="invite-link">
              <span className="invite-link__url">{secret.token}</span>
              <button
                type="button"
                className="btn btn--icon"
                onClick={() => copy(secret.token, 'Token')}
                title="Copy the token"
                aria-label="Copy the token"
              >
                <Copy />
              </button>
            </div>
            <div className="agent-secret__label">
              Point the MCP client at this address and send the token as a bearer credential.
            </div>
            <div className="invite-link">
              <span className="invite-link__url">{secret.url}</span>
              <button
                type="button"
                className="btn btn--icon"
                onClick={() => copy(secret.url, 'Address')}
                title="Copy the address"
                aria-label="Copy the address"
              >
                <Copy />
              </button>
            </div>
            <button type="button" className="btn btn--outline" onClick={() => setSecret(null)}>
              I have copied it
            </button>
          </div>
        )}

        {error === null ? null : <p className="account-form__error">{error}</p>}

        <div className="account-section">
          <div className="account-section__title">Connected agents</div>
          {list.length === 0 ? (
            <p className="account-form__note">No agents yet.</p>
          ) : null}
          {list.map((agent) => (
            <div key={agent.id}>
              <div className="people-row">
                <Avatar person={agent} size={26} />
                <div className="people-row__who">
                  <div className="people-row__name">{agent.name}</div>
                  <div className="people-row__email">
                    @{agent.handle} ·{' '}
                    {agent.lastUsed === null ? 'never connected' : `last seen ${relativeTime(agent.lastUsed)}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--icon"
                  onClick={() => (editing === agent.id ? setEditing(null) : startEdit(agent))}
                  title={`Edit ${agent.name}`}
                  aria-label={`Edit ${agent.name}`}
                >
                  <Pencil />
                </button>
                <button
                  type="button"
                  className="btn btn--icon"
                  onClick={() => rotate(agent)}
                  title="Issue a new token"
                  aria-label={`Issue a new token for ${agent.name}`}
                >
                  <Sync />
                </button>
                <button
                  type="button"
                  className="btn btn--icon"
                  onClick={() => remove(agent)}
                  title={`Delete ${agent.name}`}
                  aria-label={`Delete ${agent.name}`}
                >
                  <Trash />
                </button>
              </div>

              {editing !== agent.id ? null : (
                <div className="agent-edit">
                  <div className="account-form__row">
                    <Avatar person={agent} size={48} />
                    <button
                      type="button"
                      className="btn btn--outline"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploadAvatar.isPending}
                    >
                      Upload a picture
                    </button>
                    {agent.avatarRev === null ? null : (
                      <button
                        type="button"
                        className="btn btn--outline"
                        onClick={() => removeAvatar.mutate(agent.id)}
                        disabled={removeAvatar.isPending}
                      >
                        Remove
                      </button>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      hidden
                      accept={AVATAR_MIME_TYPES.join(',')}
                      aria-label={`Picture of ${agent.name}`}
                      onChange={(event) => pickAvatar(agent, event)}
                    />
                  </div>
                  <p className="account-form__note">PNG, JPEG, WebP or GIF, up to 512 KB.</p>
                  <input
                    className="input"
                    aria-label={`Name of ${agent.name}`}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                  <textarea
                    className="input agent-identity"
                    placeholder={PLACEHOLDER}
                    aria-label={`Identity of ${agent.name}`}
                    maxLength={MAX_IDENTITY_LENGTH}
                    value={draft.identity}
                    onChange={(event) => setDraft({ ...draft, identity: event.target.value })}
                  />
                  <div className="account-form__row">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => save(agent)}
                      disabled={updateAgent.isPending}
                    >
                      Save
                    </button>
                    <button type="button" className="btn btn--outline" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
