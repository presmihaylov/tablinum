import { afterEach, describe, expect, it } from 'vitest';
import { isAppError, MAX_AVATAR_BYTES } from '@gitdocs/shared';
import { AccountStore } from '../src/store.js';

const open: AccountStore[] = [];

function store(): AccountStore {
  const created = new AccountStore({ dbPath: ':memory:' });
  created.init();
  open.push(created);
  return created;
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

const PASSWORD = 'a long enough passphrase';

function admin(accounts: AccountStore, email = 'ada@example.com') {
  return accounts.createUser({ email, name: 'Ada Lovelace', password: PASSWORD, role: 'admin' });
}

/** Everything hangs off a workspace, so most tests need one before anything else. */
function workspace(accounts: AccountStore, name = 'Main', dir = '/content/main') {
  return accounts.createWorkspace({ name, dir });
}

/** The error code an AppError carries, so a test can assert the wire behaviour. */
function codeOf(work: () => unknown): string {
  try {
    work();
  } catch (err) {
    return isAppError(err) ? err.code : `unexpected: ${String(err)}`;
  }
  return 'no error';
}

// A 1x1 PNG, small enough to keep in the file and real enough to store.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('users', () => {
  it('starts empty and reports the first account', () => {
    const accounts = store();
    expect(accounts.isEmpty()).toBe(true);
    expect(accounts.countUsers()).toBe(0);

    const created = admin(accounts);
    expect(accounts.isEmpty()).toBe(false);
    expect(accounts.countUsers()).toBe(1);
    expect(created.role).toBe('admin');
    expect(created.email).toBe('ada@example.com');
    expect(created.avatarRev).toBeNull();
    expect(created.disabled).toBe(false);
    expect(created.id.startsWith('us_')).toBe(true);
  });

  it('lowercases and trims the email, and refuses a second account for it', () => {
    const accounts = store();
    const created = accounts.createUser({
      email: '  Ada@Example.COM ',
      name: 'Ada',
      password: PASSWORD,
    });
    expect(created.email).toBe('ada@example.com');
    expect(accounts.getUserByEmail('ADA@example.com')?.id).toBe(created.id);

    expect(codeOf(() => accounts.createUser({ email: 'ada@example.com', name: 'Other', password: PASSWORD })))
      .toBe('CONFLICT');
  });

  it('refuses something that is not an email address', () => {
    const accounts = store();
    expect(codeOf(() => accounts.createUser({ email: 'not-an-email', name: 'X', password: PASSWORD })))
      .toBe('VALIDATION');
  });

  it('gives every account a stable presence colour', () => {
    const accounts = store();
    const created = admin(accounts);
    expect(created.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(accounts.getUser(created.id)?.color).toBe(created.color);
  });

  it('keeps the last admin an admin', () => {
    const accounts = store();
    const owner = admin(accounts);
    expect(codeOf(() => accounts.updateUser(owner.id, { role: 'member' }))).toBe('CONFLICT');
    expect(codeOf(() => accounts.updateUser(owner.id, { disabled: true }))).toBe('CONFLICT');
    expect(codeOf(() => accounts.deleteUser(owner.id))).toBe('CONFLICT');

    const second = accounts.createUser({ email: 'bob@example.com', name: 'Bob', password: PASSWORD, role: 'admin' });
    expect(accounts.updateUser(owner.id, { role: 'member' }).role).toBe('member');
    expect(accounts.getUser(second.id)?.role).toBe('admin');
  });

  it('lists accounts by name', () => {
    const accounts = store();
    accounts.createUser({ email: 'zoe@example.com', name: 'Zoe', password: PASSWORD });
    accounts.createUser({ email: 'amy@example.com', name: 'amy', password: PASSWORD });
    expect(accounts.listUsers().map((user) => user.name)).toEqual(['amy', 'Zoe']);
  });
});

describe('passwords', () => {
  it('accepts the right password and rejects the wrong one', () => {
    const accounts = store();
    const owner = admin(accounts);
    expect(accounts.checkPassword(owner.id, PASSWORD)).toBe(true);
    expect(accounts.checkPassword(owner.id, 'not the password')).toBe(false);
  });

  it('signs in by email and refuses an unknown address without saying so', () => {
    const accounts = store();
    const owner = admin(accounts);
    expect(accounts.login('ada@example.com', PASSWORD)?.id).toBe(owner.id);
    expect(accounts.login('ADA@EXAMPLE.COM', PASSWORD)?.id).toBe(owner.id);
    expect(accounts.login('ada@example.com', 'wrong')).toBeNull();
    expect(accounts.login('nobody@example.com', PASSWORD)).toBeNull();
  });

  it('refuses a disabled account even with the right password', () => {
    const accounts = store();
    admin(accounts);
    const member = accounts.createUser({ email: 'bob@example.com', name: 'Bob', password: PASSWORD });
    accounts.updateUser(member.id, { disabled: true });
    expect(accounts.login('bob@example.com', PASSWORD)).toBeNull();
  });

  it('changes a password and invalidates the old one', () => {
    const accounts = store();
    const owner = admin(accounts);
    accounts.setPassword(owner.id, 'an entirely different passphrase');
    expect(accounts.checkPassword(owner.id, PASSWORD)).toBe(false);
    expect(accounts.checkPassword(owner.id, 'an entirely different passphrase')).toBe(true);
  });

  it('never stores the password itself', () => {
    const accounts = store();
    const owner = admin(accounts);
    const encoded = JSON.stringify(accounts.getUser(owner.id));
    expect(encoded).not.toContain(PASSWORD);
    expect(encoded).not.toContain('scrypt');
  });
});

describe('sessions', () => {
  it('issues a token that resolves back to the account', () => {
    const accounts = store();
    const owner = admin(accounts);
    const session = accounts.createSession(owner.id);
    expect(session.token.length).toBeGreaterThan(30);
    expect(accounts.resolveSession(session.token)?.id).toBe(owner.id);
  });

  it('refuses an unknown token and a token that has expired', () => {
    const accounts = store();
    const owner = admin(accounts);
    const now = 1_000_000;
    const session = accounts.createSession(owner.id, now, 60_000);

    expect(accounts.resolveSession('nope')).toBeNull();
    expect(accounts.resolveSession(session.token, now + 59_000)?.id).toBe(owner.id);
    expect(accounts.resolveSession(session.token, now + 61_000)).toBeNull();
    // The expired row is dropped, so it cannot come back if the clock moves.
    expect(accounts.resolveSession(session.token, now)).toBeNull();
  });

  it('signs a browser out and leaves the other sessions alone', () => {
    const accounts = store();
    const owner = admin(accounts);
    const first = accounts.createSession(owner.id);
    const second = accounts.createSession(owner.id);

    accounts.destroySession(first.token);
    expect(accounts.resolveSession(first.token)).toBeNull();
    expect(accounts.resolveSession(second.token)?.id).toBe(owner.id);

    accounts.destroySessionsFor(owner.id);
    expect(accounts.resolveSession(second.token)).toBeNull();
  });

  it('drops every session when the account is disabled', () => {
    const accounts = store();
    admin(accounts);
    const member = accounts.createUser({ email: 'bob@example.com', name: 'Bob', password: PASSWORD });
    const session = accounts.createSession(member.id);
    accounts.updateUser(member.id, { disabled: true });
    expect(accounts.resolveSession(session.token)).toBeNull();
  });

  it('drops every session when the account is deleted', () => {
    const accounts = store();
    admin(accounts);
    const member = accounts.createUser({ email: 'bob@example.com', name: 'Bob', password: PASSWORD });
    const session = accounts.createSession(member.id);
    accounts.deleteUser(member.id);
    expect(accounts.resolveSession(session.token)).toBeNull();
  });

  it('purges expired sessions on demand', () => {
    const accounts = store();
    const owner = admin(accounts);
    accounts.createSession(owner.id, 1_000, 10);
    accounts.createSession(owner.id, 1_000, 100_000);
    expect(accounts.purgeExpiredSessions(50_000)).toBe(1);
  });
});

describe('invites', () => {
  it('turns a link into an account with the invited role', () => {
    const accounts = store();
    const owner = admin(accounts);
    const { invite, token } = accounts.createInvite({ role: 'member', createdBy: owner.id });

    expect(invite.acceptedBy).toBeNull();
    expect(accounts.getInviteByToken(token)?.id).toBe(invite.id);

    const joined = accounts.redeemInvite(token, {
      email: 'bob@example.com',
      name: 'Bob',
      password: PASSWORD,
    });
    expect(joined.role).toBe('member');
    expect(accounts.countUsers()).toBe(2);
    expect(accounts.getInvite(invite.id)?.acceptedBy).toBe(joined.id);
  });

  it('spends a link exactly once', () => {
    const accounts = store();
    const { token } = accounts.createInvite();
    accounts.redeemInvite(token, { email: 'bob@example.com', name: 'Bob', password: PASSWORD });

    expect(accounts.getInviteByToken(token)).toBeNull();
    expect(codeOf(() => accounts.redeemInvite(token, { email: 'eve@example.com', name: 'Eve', password: PASSWORD })))
      .toBe('NOT_FOUND');
    expect(accounts.countUsers()).toBe(1);
  });

  it('pins a link to one address and ignores the address in the form', () => {
    const accounts = store();
    const { token } = accounts.createInvite({ email: 'Bob@Example.com' });
    const joined = accounts.redeemInvite(token, {
      email: 'eve@example.com',
      name: 'Bob',
      password: PASSWORD,
    });
    expect(joined.email).toBe('bob@example.com');
  });

  it('needs an address when the link is open to anyone', () => {
    const accounts = store();
    const { token } = accounts.createInvite();
    expect(codeOf(() => accounts.redeemInvite(token, { name: 'Bob', password: PASSWORD })))
      .toBe('VALIDATION');
  });

  it('refuses an expired link and a revoked link', () => {
    const accounts = store();
    const now = 1_000_000;
    const expired = accounts.createInvite({ expiresInDays: 1 }, now);
    expect(accounts.getInviteByToken(expired.token, now + 2 * 24 * 3600_000)).toBeNull();

    const revoked = accounts.createInvite();
    accounts.revokeInvite(revoked.invite.id);
    expect(accounts.getInviteByToken(revoked.token)).toBeNull();
    expect(codeOf(() => accounts.redeemInvite(revoked.token, { email: 'b@example.com', name: 'B', password: PASSWORD })))
      .toBe('NOT_FOUND');
  });

  it('refuses to invite an address that already has an account', () => {
    const accounts = store();
    admin(accounts);
    expect(codeOf(() => accounts.createInvite({ email: 'ada@example.com' }))).toBe('CONFLICT');
  });

  it('rolls the account back when the invite cannot be spent', () => {
    const accounts = store();
    const first = accounts.createInvite();
    const second = accounts.createInvite();
    accounts.redeemInvite(first.token, { email: 'bob@example.com', name: 'Bob', password: PASSWORD });

    // The same address again: the account insert fails, so the second link stays unspent.
    expect(codeOf(() => accounts.redeemInvite(second.token, { email: 'bob@example.com', name: 'B', password: PASSWORD })))
      .toBe('CONFLICT');
    expect(accounts.getInviteByToken(second.token)?.id).toBe(second.invite.id);
    expect(accounts.countUsers()).toBe(1);
  });

  it('lists every invite, newest first, including the spent ones', () => {
    const accounts = store();
    const older = accounts.createInvite({ email: 'a@example.com' }, 1_000);
    const newer = accounts.createInvite({ email: 'b@example.com' }, 2_000);
    expect(accounts.listInvites().map((entry) => entry.id)).toEqual([newer.invite.id, older.invite.id]);
  });

  it('never stores the token itself', () => {
    const accounts = store();
    const { token } = accounts.createInvite();
    expect(JSON.stringify(accounts.listInvites())).not.toContain(token);
  });
});

describe('agents', () => {
  it('creates an agent with a handle and a token that is never stored', () => {
    const accounts = store();
    const main = workspace(accounts);
    const { agent, token } = accounts.createAgent({
      name: '  Doc Bot  ',
      identity: 'You keep the runbooks tidy.',
      workspaceId: main.id,
    });

    expect(agent.id.startsWith('ag_')).toBe(true);
    expect(agent.name).toBe('Doc Bot');
    expect(agent.handle).toBe('doc.bot');
    expect(agent.identity).toBe('You keep the runbooks tidy.');
    expect(agent.workspaceId).toBe(main.id);
    expect(agent.disabled).toBe(false);
    expect(agent.lastUsed).toBeNull();
    expect(token.startsWith('gda_')).toBe(true);
    expect(JSON.stringify(accounts.listAgents())).not.toContain(token);
  });

  it('refuses an empty name and an unknown workspace', () => {
    const accounts = store();
    const main = workspace(accounts);
    expect(codeOf(() => accounts.createAgent({ name: '   ', workspaceId: main.id }))).toBe('VALIDATION');
    expect(codeOf(() => accounts.createAgent({ name: 'Doc Bot', workspaceId: 'ws_nope' }))).toBe('NOT_FOUND');
  });

  it('keeps one handle namespace for people and agents', () => {
    const accounts = store();
    const main = workspace(accounts);
    accounts.createUser({ email: 'doc.bot@example.com', name: 'Doc Bot', password: PASSWORD });
    expect(accounts.createAgent({ name: 'Doc Bot', workspaceId: main.id }).agent.handle).toBe('doc.bot.2');
    expect(accounts.createAgent({ name: 'Doc Bot', workspaceId: main.id }).agent.handle).toBe('doc.bot.3');

    // And the other way round: a person cannot take a handle an agent already holds.
    const later = accounts.createUser({ email: 'db@example.com', name: 'Doc Bot', password: PASSWORD });
    expect(later.handle).toBe('doc.bot.4');
  });

  it('finds an agent by id and by handle', () => {
    const accounts = store();
    const main = workspace(accounts);
    const { agent } = accounts.createAgent({ name: 'Doc Bot', workspaceId: main.id });
    expect(accounts.getAgent(agent.id)?.id).toBe(agent.id);
    expect(accounts.getAgentByHandle('@Doc.Bot')?.id).toBe(agent.id);
    expect(accounts.getAgent('ag_00000000000000000000000000')).toBeNull();
    expect(accounts.getAgentByHandle('nobody')).toBeNull();
  });

  it('resolves a token, and refuses an unknown one or a switched off agent', () => {
    const accounts = store();
    const main = workspace(accounts);
    const { agent, token } = accounts.createAgent({ name: 'Doc Bot', workspaceId: main.id });

    expect(accounts.resolveAgentToken(token)?.id).toBe(agent.id);
    expect(accounts.resolveAgentToken('gda_not-a-real-token')).toBeNull();

    accounts.updateAgent(agent.id, { disabled: true });
    expect(accounts.resolveAgentToken(token)).toBeNull();

    accounts.updateAgent(agent.id, { disabled: false });
    expect(accounts.resolveAgentToken(token)?.id).toBe(agent.id);
  });

  it('stamps last use, but not on every single call', () => {
    const accounts = store();
    const main = workspace(accounts);
    const { agent, token } = accounts.createAgent({ name: 'Doc Bot', workspaceId: main.id });
    const start = 5_000_000;

    accounts.resolveAgentToken(token, start);
    const first = accounts.getAgent(agent.id)?.lastUsed;
    expect(first).not.toBeNull();

    accounts.resolveAgentToken(token, start + 1_000);
    expect(accounts.getAgent(agent.id)?.lastUsed).toBe(first);

    accounts.resolveAgentToken(token, start + 120_000);
    expect(accounts.getAgent(agent.id)?.lastUsed).not.toBe(first);
  });

  it('changes the name and the identity but never the handle', () => {
    const accounts = store();
    const main = workspace(accounts);
    const { agent } = accounts.createAgent({
      name: 'Doc Bot',
      identity: 'Tidy the runbooks.',
      workspaceId: main.id,
    });

    const updated = accounts.updateAgent(agent.id, { name: 'Release Bot', identity: '  Write notes.  ' });
    expect(updated.name).toBe('Release Bot');
    expect(updated.identity).toBe('Write notes.');
    expect(updated.handle).toBe('doc.bot');

    // An empty patch leaves everything as it was.
    expect(accounts.updateAgent(agent.id, {}).name).toBe('Release Bot');
    expect(codeOf(() => accounts.updateAgent('ag_00000000000000000000000000', { name: 'X' })))
      .toBe('NOT_FOUND');
  });

  it('rotates the token and retires the old one', () => {
    const accounts = store();
    const main = workspace(accounts);
    const { agent, token } = accounts.createAgent({ name: 'Doc Bot', workspaceId: main.id });

    const next = accounts.rotateAgentToken(agent.id);
    expect(next.token).not.toBe(token);
    expect(accounts.resolveAgentToken(token)).toBeNull();
    expect(accounts.resolveAgentToken(next.token)?.id).toBe(agent.id);
    expect(codeOf(() => accounts.rotateAgentToken('ag_00000000000000000000000000'))).toBe('NOT_FOUND');
  });

  it('deletes an agent, which takes its token with it', () => {
    const accounts = store();
    const main = workspace(accounts);
    const { agent, token } = accounts.createAgent({ name: 'Doc Bot', workspaceId: main.id });

    accounts.deleteAgent(agent.id);
    expect(accounts.getAgent(agent.id)).toBeNull();
    expect(accounts.resolveAgentToken(token)).toBeNull();
    expect(codeOf(() => accounts.deleteAgent(agent.id))).toBe('NOT_FOUND');
  });

  it('lists agents by name, and by workspace when asked', () => {
    const accounts = store();
    const main = workspace(accounts);
    const other = workspace(accounts, 'Design', '/content/design');
    accounts.createAgent({ name: 'Zoe Bot', workspaceId: main.id });
    accounts.createAgent({ name: 'Doc Bot', workspaceId: main.id });
    accounts.createAgent({ name: 'Art Bot', workspaceId: other.id });

    expect(accounts.listAgents().map((agent) => agent.name)).toEqual(['Art Bot', 'Doc Bot', 'Zoe Bot']);
    expect(accounts.listAgents(main.id).map((agent) => agent.name)).toEqual(['Doc Bot', 'Zoe Bot']);
    expect(accounts.listAgents(other.id).map((agent) => agent.name)).toEqual(['Art Bot']);
  });

  it('takes its agents with it when a workspace goes', () => {
    const accounts = store();
    const main = workspace(accounts);
    const other = workspace(accounts, 'Design', '/content/design');
    const { agent, token } = accounts.createAgent({ name: 'Art Bot', workspaceId: other.id });

    accounts.deleteWorkspace(other.id);
    expect(accounts.getAgent(agent.id)).toBeNull();
    expect(accounts.resolveAgentToken(token)).toBeNull();
    expect(accounts.listWorkspaces().map((entry) => entry.id)).toEqual([main.id]);
  });
});

describe('workspaces', () => {
  it('creates one with a slug from the name and keeps slugs unique', () => {
    const accounts = store();
    const main = accounts.createWorkspace({ name: '  Main Docs  ', dir: '/content/main' });
    expect(main.id.startsWith('ws_')).toBe(true);
    expect(main.name).toBe('Main Docs');
    expect(main.slug).toBe('main-docs');
    expect(main.icon).toBeUndefined();

    const twin = accounts.createWorkspace({ name: 'Main Docs', dir: '/content/twin' });
    expect(twin.slug).toBe('main-docs-2');
  });

  it('refuses an empty name and a directory that is already taken', () => {
    const accounts = store();
    accounts.createWorkspace({ name: 'Main', dir: '/content/main' });
    expect(codeOf(() => accounts.createWorkspace({ name: '  ', dir: '/content/x' }))).toBe('VALIDATION');
    expect(codeOf(() => accounts.createWorkspace({ name: 'Again', dir: '/content/main' }))).toBe('CONFLICT');
  });

  it('finds a workspace by id, by slug and by directory', () => {
    const accounts = store();
    const main = accounts.createWorkspace({ name: 'Main', dir: '/content/main' });
    expect(accounts.getWorkspace(main.id)?.slug).toBe('main');
    expect(accounts.getWorkspaceBySlug('MAIN')?.id).toBe(main.id);
    expect(accounts.getWorkspaceByDir('/content/main')?.id).toBe(main.id);
    expect(accounts.getWorkspaceBySlug('nope')).toBeNull();
    expect(accounts.getWorkspaceByDir('/content/nope')).toBeNull();
  });

  it('renames, re-slugs and clears the icon', () => {
    const accounts = store();
    const main = accounts.createWorkspace({ name: 'Main', dir: '/content/main', icon: '📘' });
    expect(main.icon).toBe('📘');

    const renamed = accounts.updateWorkspace(main.id, { name: 'Handbook', slug: 'handbook' });
    expect(renamed.name).toBe('Handbook');
    expect(renamed.slug).toBe('handbook');
    expect(renamed.icon).toBe('📘');

    expect(accounts.updateWorkspace(main.id, { icon: null }).icon).toBeUndefined();

    accounts.createWorkspace({ name: 'Design', dir: '/content/design' });
    expect(codeOf(() => accounts.updateWorkspace(main.id, { slug: 'design' }))).toBe('CONFLICT');
    expect(codeOf(() => accounts.updateWorkspace('ws_nope', { name: 'X' }))).toBe('NOT_FOUND');
  });

  it('refuses to delete the last workspace', () => {
    const accounts = store();
    const main = accounts.createWorkspace({ name: 'Main', dir: '/content/main' });
    expect(codeOf(() => accounts.deleteWorkspace(main.id))).toBe('CONFLICT');

    const other = accounts.createWorkspace({ name: 'Design', dir: '/content/design' });
    accounts.deleteWorkspace(other.id);
    expect(accounts.listWorkspaces().map((entry) => entry.id)).toEqual([main.id]);
    expect(codeOf(() => accounts.deleteWorkspace('ws_nope'))).toBe('NOT_FOUND');
  });

  it('adopts everything that existed before workspaces into the first one', () => {
    const accounts = store();
    const owner = admin(accounts);
    const { invite } = accounts.createInvite({ role: 'member', createdBy: owner.id });
    expect(accounts.getInvite(invite.id)?.workspaceId).toBeNull();

    const main = accounts.ensureWorkspaceForDir('/content/main', 'Main', 'main');
    expect(main.slug).toBe('main');
    expect(accounts.getInvite(invite.id)?.workspaceId).toBe(main.id);
    expect(accounts.memberRole(main.id, owner.id)).toBe('admin');

    // A second call is a lookup, not a second workspace.
    expect(accounts.ensureWorkspaceForDir('/content/main', 'Ignored').id).toBe(main.id);
    expect(accounts.listWorkspaces()).toHaveLength(1);
  });

  it('leaves a later workspace to fill its own membership', () => {
    const accounts = store();
    const owner = admin(accounts);
    accounts.ensureWorkspaceForDir('/content/main', 'Main');
    const design = accounts.ensureWorkspaceForDir('/content/design', 'Design');
    expect(accounts.memberRole(design.id, owner.id)).toBeNull();
  });

  it('adds, re-roles and removes members', () => {
    const accounts = store();
    const owner = admin(accounts);
    const bob = accounts.createUser({ email: 'bob@example.com', name: 'Bob', password: PASSWORD });
    const main = accounts.createWorkspace({ name: 'Main', dir: '/content/main' });

    accounts.addMember(main.id, owner.id, 'admin');
    accounts.addMember(main.id, bob.id);
    expect(accounts.listMembers(main.id)).toEqual([
      { userId: owner.id, role: 'admin' },
      { userId: bob.id, role: 'member' },
    ]);

    accounts.addMember(main.id, bob.id, 'admin');
    expect(accounts.memberRole(main.id, bob.id)).toBe('admin');
    expect(accounts.listMembers(main.id)).toHaveLength(2);

    accounts.removeMember(main.id, bob.id);
    expect(accounts.memberRole(main.id, bob.id)).toBeNull();
    expect(codeOf(() => accounts.removeMember(main.id, bob.id))).toBe('NOT_FOUND');
    expect(codeOf(() => accounts.addMember('ws_nope', owner.id))).toBe('NOT_FOUND');
    expect(codeOf(() => accounts.addMember(main.id, 'us_nope'))).toBe('NOT_FOUND');
  });

  it('gives somebody with no membership the first workspace', () => {
    const accounts = store();
    const owner = admin(accounts);
    const main = accounts.createWorkspace({ name: 'Main', dir: '/content/main' });
    const design = accounts.createWorkspace({ name: 'Design', dir: '/content/design' });

    expect(accounts.listWorkspacesFor(owner.id).map((entry) => entry.id)).toEqual([main.id]);

    accounts.addMember(design.id, owner.id);
    expect(accounts.listWorkspacesFor(owner.id).map((entry) => entry.id)).toEqual([design.id]);

    accounts.addMember(main.id, owner.id);
    expect(accounts.listWorkspacesFor(owner.id).map((entry) => entry.id)).toEqual([main.id, design.id]);
  });

  it('puts a redeemed invite straight into its workspace', () => {
    const accounts = store();
    const owner = admin(accounts);
    const main = accounts.createWorkspace({ name: 'Main', dir: '/content/main' });
    const design = accounts.createWorkspace({ name: 'Design', dir: '/content/design' });

    const { token } = accounts.createInvite({ role: 'admin', createdBy: owner.id, workspaceId: design.id });
    const joined = accounts.redeemInvite(token, { email: 'bob@example.com', name: 'Bob', password: PASSWORD });

    expect(accounts.memberRole(design.id, joined.id)).toBe('admin');
    expect(accounts.memberRole(main.id, joined.id)).toBeNull();
    expect(accounts.listWorkspacesFor(joined.id).map((entry) => entry.id)).toEqual([design.id]);
  });
});

describe('avatars', () => {
  it('stores an image and hands back a revision that changes with the bytes', () => {
    const accounts = store();
    const owner = admin(accounts);

    const rev = accounts.setAvatar(owner.id, 'image/png', PNG);
    expect(accounts.getUser(owner.id)?.avatarRev).toBe(rev);

    const stored = accounts.getAvatar(owner.id);
    expect(stored?.mime).toBe('image/png');
    expect(stored?.bytes.equals(PNG)).toBe(true);

    const other = accounts.setAvatar(owner.id, 'image/png', Buffer.concat([PNG, Buffer.from([0])]));
    expect(other).not.toBe(rev);
  });

  it('refuses a type that is not an image and anything too large', () => {
    const accounts = store();
    const owner = admin(accounts);
    expect(codeOf(() => accounts.setAvatar(owner.id, 'application/pdf', PNG))).toBe('VALIDATION');
    expect(codeOf(() => accounts.setAvatar(owner.id, 'image/png', Buffer.alloc(0)))).toBe('VALIDATION');
    expect(codeOf(() => accounts.setAvatar(owner.id, 'image/png', Buffer.alloc(MAX_AVATAR_BYTES + 1))))
      .toBe('VALIDATION');
  });

  it('takes an avatar away again', () => {
    const accounts = store();
    const owner = admin(accounts);
    accounts.setAvatar(owner.id, 'image/png', PNG);
    accounts.clearAvatar(owner.id);
    expect(accounts.getAvatar(owner.id)).toBeNull();
    expect(accounts.getUser(owner.id)?.avatarRev).toBeNull();
  });

  it('reports no avatar for an account that never had one', () => {
    const accounts = store();
    expect(accounts.getAvatar(admin(accounts).id)).toBeNull();
  });
});
