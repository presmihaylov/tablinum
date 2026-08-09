import { LIVE_COLORS, type Account, type LiveUser } from '@gitdocs/shared';
import { readStored, writeStored } from './storage';

const USER_KEY = 'live.user';

/**
 * A browser names itself when nobody is signed in. Once an account is, that account wins.
 * The name is kept for the life of the profile; the tab id is minted per tab and never persists.
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
let accountUser: LiveUser | null = null;

type IdentityListener = (user: LiveUser) => void;
const listeners = new Set<IdentityListener>();

/** Told when the person behind this tab changes, so the live channel can say hello again. */
export function onIdentityChange(listener: IdentityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The signed-in account replaces the anonymous name. Null goes back to the stored one. */
export function setAccountIdentity(account: Account | null): void {
  const next: LiveUser | null =
    account === null ? null : { id: account.id, name: account.name, color: account.color };
  if (next?.id === accountUser?.id && next?.name === accountUser?.name) return;
  accountUser = next;
  const user = myUser();
  for (const listener of [...listeners]) listener(user);
}

/** Who this tab says it is: the signed-in account, or the name this browser gave itself. */
export function myUser(): LiveUser {
  if (accountUser !== null) return accountUser;
  if (cachedUser !== null) return cachedUser;
  const stored: unknown = readStored<unknown>(USER_KEY, null);
  const user = isUser(stored) ? stored : mint();
  writeStored(USER_KEY, user);
  cachedUser = user;
  return user;
}

/** True while nobody is signed in, so the anonymous name is the one being shown. */
export function isAnonymous(): boolean {
  return accountUser === null;
}

/** Change the display name shown to other people. Anonymous browsers only. */
export function renameMe(name: string): LiveUser {
  const current = myUser();
  const trimmed = name.trim().slice(0, 40);
  const user = { ...current, name: trimmed.length > 0 ? trimmed : current.name };
  if (accountUser !== null) return current;
  writeStored(USER_KEY, user);
  cachedUser = user;
  for (const listener of [...listeners]) listener(user);
  return user;
}

let cachedClientId: string | null = null;

/** Identifies this tab, not this person. Two tabs of one browser must not share it. */
export function myClientId(): string {
  if (cachedClientId === null) cachedClientId = newId();
  return cachedClientId;
}
