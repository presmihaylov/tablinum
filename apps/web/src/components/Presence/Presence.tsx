import { useEffect, useState } from 'react';
import type { LivePresence } from '@gitdocs/shared';
import { isAnonymous, myUser, onIdentityChange, renameMe } from '../../lib/identity';
import { useLive } from '../../lib/live';
import { Bot } from '../ui/Icon';
import { PromptDialog, type PromptRequest } from '../ui/PromptDialog';
import './presence.css';

/** Two letters are enough to tell one avatar from another at this size. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

function label(user: LivePresence, mine: boolean): string {
  if (user.agent !== null) {
    const who = `${user.name} (@${user.agent.handle})`;
    return user.editing ? `${who} is writing this page` : `${who} is reading this page`;
  }
  const who = mine ? `${user.name} (you)` : user.name;
  return user.editing ? `${who} is editing` : who;
}

function chipClass(user: LivePresence): string {
  const classes = ['presence__chip'];
  if (user.agent !== null) classes.push('presence__chip--agent');
  if (user.editing) classes.push('presence__chip--editing');
  return classes.join(' ');
}

/** Who else is on the page this tab shows. Nothing is drawn when nobody else is here. */
export function Presence() {
  const { presence, connected } = useLive();
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [me, setMe] = useState(() => myUser());
  const [anonymous, setAnonymous] = useState(() => isAnonymous());

  useEffect(
    () =>
      onIdentityChange((user) => {
        setMe(user);
        setAnonymous(isAnonymous());
      }),
    [],
  );

  // A signed-in name belongs to the account. Rename it in the profile dialog instead.
  const rename = (): void =>
    setPrompt({
      title: 'Change your display name',
      label: 'The name other people see',
      initialValue: me.name,
      confirmLabel: 'Rename',
      onConfirm: (value) => setMe(renameMe(value)),
    });

  const others = presence.filter((user) => user.id !== me.id);
  if (!connected || others.length === 0) {
    return <PromptDialog request={prompt} onClose={() => setPrompt(null)} />;
  }

  return (
    <>
      <div className="presence" aria-label="People on this page">
        {others.map((user) => (
          <span
            key={user.id}
            className={chipClass(user)}
            style={{ backgroundColor: user.color }}
            title={label(user, false)}
          >
            {user.agent === null ? initials(user.name) : <Bot />}
          </span>
        ))}
        {anonymous ? (
          <button
            type="button"
            className="presence__chip presence__chip--me"
            style={{ backgroundColor: me.color }}
            onClick={rename}
            title={`${me.name} (you). Click to rename.`}
          >
            {initials(me.name)}
          </button>
        ) : (
          <span
            className="presence__chip presence__chip--me"
            style={{ backgroundColor: me.color }}
            title={`${me.name} (you)`}
          >
            {initials(me.name)}
          </span>
        )}
      </div>

      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
    </>
  );
}
