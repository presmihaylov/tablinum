import type { Account, LiveUser } from '@gitdocs/shared';

/**
 * Who this tab is on the live channel. Always the signed-in account: a browser reaches the
 * shell only once it has one, so there is no anonymous name to invent and none to rename.
 */

function newId(): string {
  const random = globalThis.crypto;
  if (random && typeof random.randomUUID === 'function') return random.randomUUID();
  return `c${Math.floor(Math.random() * 1e12).toString(36)}${Date.now().toString(36)}`;
}

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

/** The signed-in account, from the auth state. Null while the answer is still on its way. */
export function setAccountIdentity(account: Account | null): void {
  const next: LiveUser | null =
    account === null ? null : { id: account.id, name: account.name, color: account.color };
  if (next?.id === accountUser?.id && next?.name === accountUser?.name) return;
  accountUser = next;
  if (next === null) return;
  for (const listener of [...listeners]) listener(next);
}

/** Who this tab says it is, or null before the account lands. */
export function myUser(): LiveUser | null {
  return accountUser;
}

let cachedClientId: string | null = null;

/** Identifies this tab, not this person. Two tabs of one browser must not share it. */
export function myClientId(): string {
  if (cachedClientId === null) cachedClientId = newId();
  return cachedClientId;
}
