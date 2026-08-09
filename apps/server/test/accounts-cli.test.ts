import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStore } from '@tablinum/accounts';
import { MIN_PASSWORD_LENGTH } from '@tablinum/shared';
import { run } from '../src/accounts-cli.js';

const ADA = { email: 'ada@example.com', name: 'Ada Lovelace', password: 'stack-of-pancakes' };
const SAM = { email: 'sam@example.com', name: 'Sam Rivers', password: 'four-purple-kites' };

let store: AccountStore;

/** Runs a command and returns whatever it printed, one entry per line. */
function cli(...argv: string[]): string[] {
  const lines: string[] = [];
  run(store, argv, (line) => lines.push(line));
  return lines;
}

beforeEach(() => {
  store = new AccountStore({ dbPath: ':memory:' });
  store.init();
});

afterEach(() => {
  store.close();
});

describe('accounts cli', () => {
  it('says so when there is nobody yet', () => {
    expect(cli('list').join('\n')).toContain('No accounts yet');
  });

  it('lists the roster with roles', () => {
    store.createUser({ ...ADA, role: 'admin' });
    store.createUser({ ...SAM, role: 'member' });

    const lines = cli('list');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^admin\s+ada@example\.com\s+Ada Lovelace$/);
    expect(lines[1]).toMatch(/^member\s+sam@example\.com\s+Sam Rivers$/);
  });

  it('marks a disabled account', () => {
    const ada = store.createUser({ ...ADA, role: 'admin' });
    store.createUser({ ...SAM, role: 'admin' });
    store.updateUser(ada.id, { disabled: true });

    expect(cli('list')[0]).toContain('(disabled)');
  });

  it('promotes and demotes', () => {
    const ada = store.createUser({ ...ADA, role: 'admin' });
    store.createUser({ ...SAM, role: 'member' });

    expect(cli('promote', SAM.email).join('')).toContain('is now admin');
    expect(store.getUserByEmail(SAM.email)?.role).toBe('admin');

    cli('demote', ADA.email);
    expect(store.getUserByEmail(ADA.email)?.role).toBe('member');
    expect(store.getUser(ada.id)?.role).toBe('member');
  });

  it('refuses to demote the only admin', () => {
    store.createUser({ ...ADA, role: 'admin' });
    expect(() => cli('demote', ADA.email)).toThrow(/only admin/);
  });

  it('generates a password, prints it and signs the old sessions out', () => {
    const ada = store.createUser({ ...ADA, role: 'admin' });
    const old = store.createSession(ada.id);

    const printed = cli('reset-password', ADA.email).join('\n');
    const match = /is now: (\S+)/.exec(printed);
    expect(match).not.toBeNull();

    const password = match?.[1] ?? '';
    expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(store.login(ADA.email, password)).not.toBeNull();
    expect(store.login(ADA.email, ADA.password)).toBeNull();
    expect(store.resolveSession(old.token)).toBeNull();
  });

  it('takes a password when one is given, and refuses a short one', () => {
    store.createUser({ ...ADA, role: 'admin' });

    cli('reset-password', ADA.email, 'nine-green-lanterns');
    expect(store.login(ADA.email, 'nine-green-lanterns')).not.toBeNull();

    expect(() => cli('reset-password', ADA.email, 'short')).toThrow(/at least/);
  });

  it('refuses an address nobody has', () => {
    expect(() => cli('reset-password', 'nobody@example.com')).toThrow(/No account for/);
    expect(() => cli('promote')).toThrow(/email address/);
  });

  it('creates an invite that the server can then redeem', () => {
    const printed = cli('invite', SAM.email, '--role', 'admin', '--days', '3').join('\n');
    const token = /Token:\s+(\S+)/.exec(printed)?.[1] ?? '';

    const invite = store.getInviteByToken(token);
    expect(invite?.email).toBe(SAM.email);
    expect(invite?.role).toBe('admin');
    expect(printed).toContain(`/invite/${token}`);
  });

  it('creates an open invite when no address is given', () => {
    const printed = cli('invite', '--role', 'admin').join('\n');
    const token = /Token:\s+(\S+)/.exec(printed)?.[1] ?? '';

    const invite = store.getInviteByToken(token);
    expect(invite?.email).toBeNull();
    expect(invite?.role).toBe('admin');
  });

  it('checks the invite options', () => {
    expect(() => cli('invite', '--role', 'wizard')).toThrow(/admin/);
    expect(() => cli('invite', '--days', '900')).toThrow(/1 to 90/);
  });

  it('deletes an account', () => {
    store.createUser({ ...ADA, role: 'admin' });
    store.createUser({ ...SAM, role: 'admin' });

    cli('delete', SAM.email);
    expect(store.getUserByEmail(SAM.email)).toBeNull();
  });

  it('answers an unknown command with the usage', () => {
    expect(() => cli('frobnicate')).toThrow(/reset-password/);
  });
});
