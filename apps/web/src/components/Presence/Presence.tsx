import { useEffect, useState } from 'react';
import type { LivePresence, LiveUser } from '@gitdocs/shared';
import { myUser, onIdentityChange } from '../../lib/identity';
import { useLive } from '../../lib/live';
import { Bot } from '../ui/Icon';
import './presence.css';

/** Two letters are enough to tell one avatar from another at this size. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

function label(user: LivePresence): string {
  if (user.agent !== null) {
    const who = `${user.name} (@${user.agent.handle})`;
    return user.editing ? `${who} is writing this page` : `${who} is reading this page`;
  }
  return user.editing ? `${user.name} is editing` : user.name;
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
  const [me, setMe] = useState<LiveUser | null>(() => myUser());

  useEffect(() => onIdentityChange((user) => setMe(user)), []);

  const others = presence.filter((user) => user.id !== me?.id);
  if (!connected || me === null || others.length === 0) return null;

  return (
    <div className="presence" aria-label="People on this page">
      {others.map((user) => (
        <span
          key={user.id}
          className={chipClass(user)}
          style={{ backgroundColor: user.color }}
          title={label(user)}
        >
          {user.agent === null ? initials(user.name) : <Bot />}
        </span>
      ))}
      <span
        className="presence__chip presence__chip--me"
        style={{ backgroundColor: me.color }}
        title={`${me.name} (you)`}
      >
        {initials(me.name)}
      </span>
    </div>
  );
}
