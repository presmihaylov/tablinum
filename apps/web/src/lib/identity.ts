import { LIVE_COLORS, type LiveUser } from '@gitdocs/shared';
import { readStored, writeStored } from './storage';

const USER_KEY = 'live.user';

/**
 * gitdocs has no accounts, so a browser names itself. The name is kept for the life of the
 * profile; the tab id is minted per tab and never persists.
 */
const ANIMALS = [
  'Otter',
  'Falcon',
  'Heron',
  'Lynx',
  'Marten',
  'Ibis',
  'Badger',
  'Kestrel',
  'Puffin',
  'Tapir',
  'Vervet',
  'Wombat',
] as const;

const MOODS = ['Quiet', 'Bright', 'Swift', 'Calm', 'Keen', 'Bold', 'Warm', 'Nimble'] as const;

function newId(): string {
  const random = globalThis.crypto;
  if (random && typeof random.randomUUID === 'function') return random.randomUUID();
  return `c${Math.floor(Math.random() * 1e12).toString(36)}${Date.now().toString(36)}`;
}

function pick<T>(items: readonly T[], fallback: T): T {
  return items[Math.floor(Math.random() * items.length)] ?? fallback;
}

function mint(): LiveUser {
  return {
    id: newId(),
    name: `${pick(MOODS, 'Quiet')} ${pick(ANIMALS, 'Otter')}`,
    color: pick(LIVE_COLORS, LIVE_COLORS[0]),
  };
}

function isUser(value: unknown): value is LiveUser {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, color } = value as Record<string, unknown>;
  return typeof id === 'string' && typeof name === 'string' && typeof color === 'string';
}

let cachedUser: LiveUser | null = null;

/** Who this browser says it is. Stable across reloads, shared by every tab of the profile. */
export function myUser(): LiveUser {
  if (cachedUser !== null) return cachedUser;
  const stored: unknown = readStored<unknown>(USER_KEY, null);
  const user = isUser(stored) ? stored : mint();
  writeStored(USER_KEY, user);
  cachedUser = user;
  return user;
}

/** Change the display name shown to other people. */
export function renameMe(name: string): LiveUser {
  const trimmed = name.trim().slice(0, 40);
  const user = { ...myUser(), name: trimmed.length > 0 ? trimmed : myUser().name };
  writeStored(USER_KEY, user);
  cachedUser = user;
  return user;
}

let cachedClientId: string | null = null;

/** Identifies this tab, not this person. Two tabs of one browser must not share it. */
export function myClientId(): string {
  if (cachedClientId === null) cachedClientId = newId();
  return cachedClientId;
}
