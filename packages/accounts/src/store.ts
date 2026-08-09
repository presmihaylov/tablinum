import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import {
  AGENT_TOKEN_PREFIX,
  AVATAR_MIME_TYPES,
  CUSTOM_EMOJI_MIME_TYPES,
  DEFAULT_INVITE_DAYS,
  MAX_AVATAR_BYTES,
  MAX_CUSTOM_EMOJI_BYTES,
  MAX_SHORTCODE_LENGTH,
  colorForId,
  conflict,
  isShortcode,
  newAgentId,
  newCustomEmojiId,
  newInviteId,
  newUserId,
  newWorkspaceId,
  notFound,
  sniffImageMime,
  toHandle,
  unauthorized,
  uniqueHandle,
  validation,
  workspaceSlugOf,
  type Account,
  type AccountRole,
  type Agent,
  type CustomEmoji,
  type Invite,
  type Workspace,
  type WorkspaceRole,
} from '@tablinum/shared';
import { DECOY_HASH, hashPassword, verifyPassword } from './passwords.js';
import { digestOf, hashToken, newToken } from './tokens.js';

type Db = Database.Database;

/** Filename of the account database. It lives beside the search index, never in the repo. */
export const ACCOUNTS_DB_FILENAME = 'accounts.db';

/** Bumped when the schema below changes in a way an existing file cannot satisfy. */
const SCHEMA_VERSION = 5;

/** How long a signed-in browser stays signed in. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the account database sits for a given content root. */
export function defaultAccountsDbPath(contentDir: string): string {
  return resolve(contentDir, '..', ACCOUNTS_DB_FILENAME);
}

export interface AccountStoreOptions {
  /** Absolute path of the SQLite file, or ":memory:" for a throwaway store. */
  dbPath: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role?: AccountRole;
  color?: string;
  /** Derived from the name when it is absent. A taken handle gets a numeric suffix. */
  handle?: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: AccountRole;
  disabled?: boolean;
  color?: string;
}

export interface CreateInviteInput {
  email?: string | null;
  role?: AccountRole;
  createdBy?: string | null;
  expiresInDays?: number;
  /** The workspace the invited person joins when the link is redeemed. */
  workspaceId?: string | null;
}

/** A workspace plus the directory its git repository lives in, which never goes on the wire. */
export interface WorkspaceRecord extends Workspace {
  /** Absolute path of the content root. */
  dir: string;
}

export interface CreateWorkspaceInput {
  name: string;
  dir: string;
  /** Derived from the name when it is absent. A taken slug gets a numeric suffix. */
  slug?: string;
  icon?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  icon?: string | null;
}

/** One person's place in one workspace. */
export interface Membership {
  userId: string;
  role: WorkspaceRole;
}

/** A session as it is handed to the browser. The token never appears again. */
export interface IssuedSession {
  token: string;
  expires: string;
}

/** An invite as it is handed to the admin who made it. The token never appears again. */
export interface IssuedInvite {
  invite: Invite;
  token: string;
}

export interface CreateAgentInput {
  name: string;
  /** The workspace this agent writes to. Its token reaches nothing else. */
  workspaceId: string;
  /** Who the agent is. The MCP server hands this back to the agent as its instructions. */
  identity?: string;
  /** Derived from the name when it is absent. A taken handle gets a numeric suffix. */
  handle?: string;
}

export interface UpdateAgentInput {
  name?: string;
  identity?: string;
  disabled?: boolean;
}

/** An agent as it is handed to the admin who made it. The token never appears again. */
export interface IssuedAgent {
  agent: Agent;
  token: string;
}

export interface Avatar {
  mime: string;
  bytes: Buffer;
  rev: string;
}

export interface CreateCustomEmojiInput {
  /** Lower-case `[a-z0-9_-]+`. Unique across the install. */
  shortcode: string;
  /** Who uploaded it. */
  userId: string;
  /** The image itself. Its type is read from these bytes, never from a declared one. */
  bytes: Buffer;
}

/** Who is asking to delete a custom emoji. An admin may delete anybody's. */
export interface CustomEmojiActor {
  userId: string;
  admin: boolean;
}

/** A stored custom emoji image, ready to be served. */
export interface CustomEmojiImage {
  mime: string;
  bytes: Buffer;
  rev: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  handle: string;
  role: string;
  color: string;
  password_hash: string;
  avatar_rev: string | null;
  disabled: number;
  created: number;
  updated: number;
}

interface InviteRow {
  id: string;
  email: string | null;
  role: string;
  created_by: string | null;
  created: number;
  expires: number;
  accepted_by: string | null;
  accepted: number | null;
  revoked: number;
  workspace_id: string | null;
}

interface AgentRow {
  id: string;
  name: string;
  handle: string;
  identity: string;
  workspace_id: string;
  disabled: number;
  created: number;
  updated: number;
  last_used: number | null;
}

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  dir: string;
  created: number;
  updated: number;
}

interface MemberRow {
  user_id: string;
  role: string;
}

interface AvatarRow {
  avatar_mime: string | null;
  avatar_bytes: Buffer | null;
  avatar_rev: string | null;
}

interface CustomEmojiRow {
  id: string;
  shortcode: string;
  mime: string;
  user_id: string;
  created: number;
}

interface CustomEmojiImageRow {
  mime: string;
  bytes: Buffer;
}

interface CountRow {
  total: number;
}

interface SessionRow {
  user_id: string;
  expires: number;
}

const USER_COLUMNS =
  'id, email, name, handle, role, color, password_hash, avatar_rev, disabled, created, updated';

const AGENT_COLUMNS =
  'id, name, handle, identity, workspace_id, disabled, created, updated, last_used';

const WORKSPACE_COLUMNS = 'id, slug, name, icon, dir, created, updated';

/** Never selects `bytes`: a list of emoji is metadata, and the images are fetched one by one. */
const CUSTOM_EMOJI_COLUMNS = 'id, shortcode, mime, user_id, created';

/** A `last_used` stamp is refreshed at most this often, so a busy agent is not a write loop. */
const LAST_USED_INTERVAL_MS = 60_000;

const iso = (ms: number): string => new Date(ms).toISOString();

function asRole(value: string): AccountRole {
  return value === 'admin' ? 'admin' : 'member';
}

function toAccount(row: UserRow): Account {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    handle: row.handle,
    role: asRole(row.role),
    color: row.color,
    avatarRev: row.avatar_rev,
    disabled: row.disabled === 1,
    created: iso(row.created),
    updated: iso(row.updated),
  };
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    identity: row.identity,
    workspaceId: row.workspace_id,
    disabled: row.disabled === 1,
    created: iso(row.created),
    updated: iso(row.updated),
    lastUsed: row.last_used === null ? null : iso(row.last_used),
  };
}

function toWorkspace(row: WorkspaceRow): WorkspaceRecord {
  const record: WorkspaceRecord = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    dir: row.dir,
    created: iso(row.created),
    updated: iso(row.updated),
  };
  if (row.icon !== null && row.icon.length > 0) record.icon = row.icon;
  return record;
}

function toCustomEmoji(row: CustomEmojiRow): CustomEmoji {
  return {
    id: row.id,
    shortcode: row.shortcode,
    mime: row.mime,
    userId: row.user_id,
    created: iso(row.created),
  };
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    email: row.email,
    role: asRole(row.role),
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    created: iso(row.created),
    expires: iso(row.expires),
    acceptedBy: row.accepted_by,
    accepted: row.accepted === null ? null : iso(row.accepted),
    revoked: row.revoked === 1,
  };
}

function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw validation(`${JSON.stringify(email)} is not an email address`);
  }
  return trimmed;
}

/**
 * Every account, its password, its sessions, its avatar and every invite link.
 *
 * It is deliberately a second database rather than a table in the content repo: passwords and
 * avatars are not documentation, they must never be committed, and they must not travel to a
 * git remote. Everything here is synchronous, because better-sqlite3 is.
 */
export class AccountStore {
  readonly #dbPath: string;
  #db: Db | null = null;
  /** Cached so the auth hook can ask "has anybody claimed this server?" on every request. */
  #userCount: number | null = null;

  constructor(options: AccountStoreOptions) {
    this.#dbPath = options.dbPath;
  }

  get dbPath(): string {
    return this.#dbPath;
  }

  /** Open the file and create the schema. Safe to call more than once. */
  init(): void {
    if (this.#db !== null) return;
    if (this.#dbPath !== ':memory:') mkdirSync(dirname(this.#dbPath), { recursive: true });

    const db = new Database(this.#dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    this.#migrate(db);
    this.#db = db;
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
    this.#userCount = null;
  }

  get #handle(): Db {
    if (this.#db === null) throw new Error('AccountStore.init() has not been called');
    return this.#db;
  }

  #migrate(db: Db): void {
    const found = db.pragma('user_version', { simple: true });
    const version = typeof found === 'number' ? found : 0;
    if (version === SCHEMA_VERSION) return;

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        handle        TEXT,
        slack_user_id TEXT,
        role          TEXT NOT NULL,
        color         TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        avatar_mime   TEXT,
        avatar_bytes  BLOB,
        avatar_rev    TEXT,
        disabled      INTEGER NOT NULL DEFAULT 0,
        created       INTEGER NOT NULL,
        updated       INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created    INTEGER NOT NULL,
        expires    INTEGER NOT NULL,
        seen       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS invites (
        id          TEXT PRIMARY KEY,
        token_hash  TEXT NOT NULL UNIQUE,
        email       TEXT,
        role        TEXT NOT NULL,
        created_by  TEXT,
        created     INTEGER NOT NULL,
        expires     INTEGER NOT NULL,
        accepted_by TEXT,
        accepted    INTEGER,
        revoked     INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS agents (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        handle     TEXT NOT NULL UNIQUE,
        identity   TEXT NOT NULL DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE,
        disabled   INTEGER NOT NULL DEFAULT 0,
        created    INTEGER NOT NULL,
        updated    INTEGER NOT NULL,
        last_used  INTEGER
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id      TEXT PRIMARY KEY,
        slug    TEXT NOT NULL UNIQUE,
        name    TEXT NOT NULL,
        icon    TEXT,
        dir     TEXT NOT NULL UNIQUE,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role         TEXT NOT NULL,
        created      INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS members_by_user ON workspace_members(user_id);

      CREATE TABLE IF NOT EXISTS custom_emoji (
        id        TEXT PRIMARY KEY,
        shortcode TEXT NOT NULL UNIQUE,
        mime      TEXT NOT NULL,
        bytes     BLOB NOT NULL,
        user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS emoji_by_user ON custom_emoji(user_id);
    `);

    // Version 1 predates mentions, so its accounts have no handle yet.
    addColumn(db, 'users', 'handle', 'TEXT');
    addColumn(db, 'users', 'slack_user_id', 'TEXT');
    backfillHandles(db);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_by_handle ON users(handle)');

    // Version 3 predates workspaces. Whatever it holds belongs to the first workspace, which
    // ensureWorkspaceForDir() adopts these rows into on the next boot.
    addColumn(db, 'agents', 'workspace_id', 'TEXT');
    addColumn(db, 'invites', 'workspace_id', 'TEXT');

    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  /** People and agents share one handle namespace, so `@handle` names exactly one writer. */
  #handleTaken = (candidate: string): boolean =>
    this.getUserByHandle(candidate) !== null || this.getAgentByHandle(candidate) !== null;

  /** A free handle for a name, checked against every account that exists now. */
  #freeHandle(name: string, email: string): string {
    const base = toHandle(name) === 'user' ? toHandle(email.split('@')[0] ?? '') : toHandle(name);
    return uniqueHandle(base, this.#handleTaken);
  }

  // -------------------------------------------------------------------------
  // workspaces
  // -------------------------------------------------------------------------

  /** Every workspace on this install, oldest first. The oldest one is the default. */
  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.#handle
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces ORDER BY created, id`)
      .all() as WorkspaceRow[];
    return rows.map(toWorkspace);
  }

  getWorkspace(id: string): WorkspaceRecord | null {
    const row = this.#handle
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?`)
      .get(id) as WorkspaceRow | undefined;
    return row === undefined ? null : toWorkspace(row);
  }

  getWorkspaceBySlug(slug: string): WorkspaceRecord | null {
    const row = this.#handle
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE slug = ?`)
      .get(slug.trim().toLowerCase()) as WorkspaceRow | undefined;
    return row === undefined ? null : toWorkspace(row);
  }

  getWorkspaceByDir(dir: string): WorkspaceRecord | null {
    const row = this.#handle
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE dir = ?`)
      .get(dir) as WorkspaceRow | undefined;
    return row === undefined ? null : toWorkspace(row);
  }

  createWorkspace(input: CreateWorkspaceInput, now: number = Date.now()): WorkspaceRecord {
    const name = input.name.trim();
    if (name.length === 0) throw validation('A name is required');
    if (input.dir.trim().length === 0) throw validation('A directory is required');
    if (this.getWorkspaceByDir(input.dir) !== null) {
      throw conflict(`A workspace already uses ${input.dir}`);
    }

    const id = newWorkspaceId(now);
    const slug = this.#freeSlug(input.slug ?? workspaceSlugOf(name));
    this.#handle
      .prepare(
        `INSERT INTO workspaces (id, slug, name, icon, dir, created, updated)
         VALUES (@id, @slug, @name, @icon, @dir, @now, @now)`,
      )
      .run({ id, slug, name, icon: input.icon ?? null, dir: input.dir, now });

    const created = this.getWorkspace(id);
    if (created === null) throw new Error('the workspace vanished right after it was written');
    return created;
  }

  updateWorkspace(id: string, patch: UpdateWorkspaceInput, now: number = Date.now()): WorkspaceRecord {
    const current = this.getWorkspace(id);
    if (current === null) throw notFound(`No workspace with id ${id}`);

    const wanted = patch.slug?.trim().toLowerCase();
    if (wanted !== undefined && wanted !== current.slug) {
      const taken = this.getWorkspaceBySlug(wanted);
      if (taken !== null) throw conflict(`Another workspace already uses the slug ${wanted}`);
    }

    const icon = patch.icon === undefined ? (current.icon ?? null) : patch.icon;
    this.#handle
      .prepare('UPDATE workspaces SET slug = @slug, name = @name, icon = @icon, updated = @now WHERE id = @id')
      .run({
        id,
        slug: wanted ?? current.slug,
        name: patch.name?.trim() ?? current.name,
        icon: icon === null || icon.length === 0 ? null : icon,
        now,
      });

    const updated = this.getWorkspace(id);
    if (updated === null) throw notFound(`No workspace with id ${id}`);
    return updated;
  }

  /** Forget a workspace. The directory it names is left on disk for the caller to deal with. */
  deleteWorkspace(id: string): void {
    if (this.getWorkspace(id) === null) throw notFound(`No workspace with id ${id}`);
    if (this.listWorkspaces().length <= 1) {
      throw conflict('This is the only workspace. Create another one first.');
    }
    // Agents belong to one workspace and hold a credential, so they go with it.
    this.#handle.prepare('DELETE FROM agents WHERE workspace_id = ?').run(id);
    this.#handle.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }

  /**
   * The workspace for a content directory, created when it is not there yet.
   * The very first one adopts everything written before workspaces existed, so an install that
   * upgrades keeps its people, its agents and its open invites.
   */
  ensureWorkspaceForDir(dir: string, name: string, slug?: string, now: number = Date.now()): WorkspaceRecord {
    const existing = this.getWorkspaceByDir(dir);
    if (existing !== null) return existing;

    const first = this.listWorkspaces().length === 0;
    const record = this.createWorkspace({ name, dir, ...(slug === undefined ? {} : { slug }) }, now);
    if (!first) return record;

    this.#handle.prepare('UPDATE agents SET workspace_id = ? WHERE workspace_id IS NULL').run(record.id);
    this.#handle.prepare('UPDATE invites SET workspace_id = ? WHERE workspace_id IS NULL').run(record.id);
    this.#handle
      .prepare(
        `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created)
         SELECT ?, id, role, ? FROM users`,
      )
      .run(record.id, now);
    return record;
  }

  /**
   * A slug nothing is using yet. The caller needs it before createWorkspace(), because the
   * directory a workspace lives in is named after its slug.
   */
  freeWorkspaceSlug(candidate: string): string {
    return this.#freeSlug(candidate);
  }

  /** Slugs are unique; a taken one gets a numeric suffix, exactly like a handle. */
  #freeSlug(candidate: string): string {
    const base = workspaceSlugOf(candidate);
    if (this.getWorkspaceBySlug(base) === null) return base;
    for (let n = 2; ; n += 1) {
      const next = `${base}-${n}`;
      if (this.getWorkspaceBySlug(next) === null) return next;
    }
  }

  // -------------------------------------------------------------------------
  // workspace membership
  // -------------------------------------------------------------------------

  listMembers(workspaceId: string): Membership[] {
    const rows = this.#handle
      .prepare('SELECT user_id, role FROM workspace_members WHERE workspace_id = ? ORDER BY created')
      .all(workspaceId) as MemberRow[];
    return rows.map((row) => ({ userId: row.user_id, role: asRole(row.role) }));
  }

  /** How this person stands in this workspace, or null when they are not in it. */
  memberRole(workspaceId: string, userId: string): WorkspaceRole | null {
    const row = this.#handle
      .prepare('SELECT user_id, role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .get(workspaceId, userId) as MemberRow | undefined;
    return row === undefined ? null : asRole(row.role);
  }

  addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole = 'member',
    now: number = Date.now(),
  ): void {
    if (this.getWorkspace(workspaceId) === null) throw notFound(`No workspace with id ${workspaceId}`);
    if (this.getUser(userId) === null) throw notFound(`No account with id ${userId}`);
    this.#handle
      .prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, created) VALUES (?, ?, ?, ?)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
      )
      .run(workspaceId, userId, role, now);
  }

  removeMember(workspaceId: string, userId: string): void {
    const info = this.#handle
      .prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .run(workspaceId, userId);
    if (info.changes === 0) throw notFound('That person is not in this workspace');
    // A live cookie must not outlive the membership it was reaching the workspace through.
    this.destroySessionsFor(userId);
  }

  /**
   * Every workspace this person may open, oldest first.
   * Membership is never inferred: an account with no row here reaches nothing, so removing
   * somebody from their last workspace revokes access instead of moving them to another.
   */
  listWorkspacesFor(userId: string): WorkspaceRecord[] {
    const rows = this.#handle
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS.split(', ').map((column) => `w.${column}`).join(', ')}
         FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
         WHERE m.user_id = ?
         ORDER BY w.created, w.id`,
      )
      .all(userId) as WorkspaceRow[];
    return rows.map(toWorkspace);
  }

  // -------------------------------------------------------------------------
  // users
  // -------------------------------------------------------------------------

  /** How many accounts exist. Cached, because the auth hook reads it on every request. */
  countUsers(): number {
    if (this.#userCount !== null) return this.#userCount;
    const row = this.#handle.prepare('SELECT COUNT(*) AS total FROM users').get() as CountRow;
    this.#userCount = row.total;
    return row.total;
  }

  /** True while nobody has claimed this server. */
  isEmpty(): boolean {
    return this.countUsers() === 0;
  }

  listUsers(): Account[] {
    const rows = this.#handle
      .prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY name COLLATE NOCASE, email`)
      .all() as UserRow[];
    return rows.map(toAccount);
  }

  /** The accounts in one workspace, ordered exactly like listUsers(). */
  listUsersIn(workspaceId: string): Account[] {
    const rows = this.#handle
      .prepare(
        `SELECT ${USER_COLUMNS.split(', ').map((column) => `u.${column}`).join(', ')}
         FROM users u
         JOIN workspace_members m ON m.user_id = u.id
         WHERE m.workspace_id = ?
         ORDER BY u.name COLLATE NOCASE, u.email`,
      )
      .all(workspaceId) as UserRow[];
    return rows.map(toAccount);
  }

  getUser(id: string): Account | null {
    const row = this.#handle
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
      .get(id) as UserRow | undefined;
    return row === undefined ? null : toAccount(row);
  }

  getUserByEmail(email: string): Account | null {
    const row = this.#handle
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
      .get(email.trim().toLowerCase()) as UserRow | undefined;
    return row === undefined ? null : toAccount(row);
  }

  /** The account behind an `@mention`. The handle never changes, so old pages keep resolving. */
  getUserByHandle(handle: string): Account | null {
    const row = this.#handle
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE handle = ?`)
      .get(handle.trim().replace(/^@/, '').toLowerCase()) as UserRow | undefined;
    return row === undefined ? null : toAccount(row);
  }

  createUser(input: CreateUserInput, now: number = Date.now()): Account {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    if (name.length === 0) throw validation('A name is required');
    if (this.getUserByEmail(email) !== null) {
      throw conflict(`An account already uses ${email}`);
    }

    const id = newUserId(now);
    const handle = uniqueHandle(
      input.handle === undefined ? this.#freeHandle(name, email) : toHandle(input.handle),
      this.#handleTaken,
    );
    this.#handle
      .prepare(
        `INSERT INTO users (id, email, name, handle, role, color, password_hash, disabled, created, updated)
         VALUES (@id, @email, @name, @handle, @role, @color, @hash, 0, @now, @now)`,
      )
      .run({
        id,
        email,
        name,
        handle,
        role: input.role ?? 'member',
        color: input.color ?? colorForId(id),
        hash: hashPassword(input.password),
        now,
      });
    this.#userCount = null;

    const created = this.getUser(id);
    if (created === null) throw new Error('the account vanished right after it was written');
    return created;
  }

  updateUser(id: string, patch: UpdateUserInput, now: number = Date.now()): Account {
    const current = this.getUser(id);
    if (current === null) throw notFound(`No account with id ${id}`);

    // The last admin must stay an admin, or nobody can invite anyone again.
    const losesAdmin = current.role === 'admin' && (patch.role === 'member' || patch.disabled === true);
    if (losesAdmin && this.#adminCount() <= 1) {
      throw conflict('This is the only admin. Promote somebody else first.');
    }

    const next = {
      name: patch.name?.trim() ?? current.name,
      role: patch.role ?? current.role,
      color: patch.color ?? current.color,
      disabled: patch.disabled ?? current.disabled,
    };
    this.#handle
      .prepare(
        `UPDATE users SET name = @name, role = @role, color = @color, disabled = @disabled,
         updated = @now WHERE id = @id`,
      )
      .run({ id, name: next.name, role: next.role, color: next.color, disabled: next.disabled ? 1 : 0, now });

    // A disabled account must not keep an open browser signed in.
    if (next.disabled) this.destroySessionsFor(id);

    const updated = this.getUser(id);
    if (updated === null) throw notFound(`No account with id ${id}`);
    return updated;
  }

  deleteUser(id: string): void {
    const current = this.getUser(id);
    if (current === null) throw notFound(`No account with id ${id}`);
    if (current.role === 'admin' && this.#adminCount() <= 1) {
      throw conflict('This is the only admin. Promote somebody else first.');
    }
    this.#handle.prepare('DELETE FROM users WHERE id = ?').run(id);
    this.#userCount = null;
  }

  #adminCount(): number {
    const row = this.#handle
      .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND disabled = 0")
      .get() as CountRow;
    return row.total;
  }

  // -------------------------------------------------------------------------
  // passwords
  // -------------------------------------------------------------------------

  setPassword(id: string, password: string, now: number = Date.now()): void {
    const info = this.#handle
      .prepare('UPDATE users SET password_hash = ?, updated = ? WHERE id = ?')
      .run(hashPassword(password), now, id);
    if (info.changes === 0) throw notFound(`No account with id ${id}`);
  }

  /** True when the password belongs to this account. */
  checkPassword(id: string, password: string): boolean {
    const row = this.#handle
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(id) as { password_hash: string } | undefined;
    if (row === undefined) {
      verifyPassword(password, DECOY_HASH);
      return false;
    }
    return verifyPassword(password, row.password_hash);
  }

  /**
   * The account for an email and password, or null. An unknown address costs the same as a
   * known one, so the answer never tells a caller which addresses have accounts.
   */
  login(email: string, password: string): Account | null {
    const account = this.getUserByEmail(email);
    if (account === null) {
      verifyPassword(password, DECOY_HASH);
      return null;
    }
    if (!this.checkPassword(account.id, password)) return null;
    if (account.disabled) return null;
    return account;
  }

  // -------------------------------------------------------------------------
  // sessions
  // -------------------------------------------------------------------------

  createSession(userId: string, now: number = Date.now(), ttlMs: number = SESSION_TTL_MS): IssuedSession {
    if (this.getUser(userId) === null) throw notFound(`No account with id ${userId}`);
    const token = newToken();
    const expires = now + ttlMs;
    this.#handle
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created, expires, seen)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(hashToken(token), userId, now, expires, now);
    return { token, expires: iso(expires) };
  }

  /** The account behind a session token, or null when it is unknown, expired or disabled. */
  resolveSession(token: string, now: number = Date.now()): Account | null {
    const hash = hashToken(token);
    const row = this.#handle
      .prepare('SELECT user_id, expires FROM sessions WHERE token_hash = ?')
      .get(hash) as SessionRow | undefined;
    if (row === undefined) return null;
    if (row.expires <= now) {
      this.#handle.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    const account = this.getUser(row.user_id);
    if (account === null || account.disabled) return null;
    return account;
  }

  destroySession(token: string): void {
    this.#handle.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  destroySessionsFor(userId: string): void {
    this.#handle.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  /** Drop every expired session. Called on boot; the resolve path also drops what it finds. */
  purgeExpiredSessions(now: number = Date.now()): number {
    return this.#handle.prepare('DELETE FROM sessions WHERE expires <= ?').run(now).changes;
  }

  // -------------------------------------------------------------------------
  // invites
  // -------------------------------------------------------------------------

  createInvite(input: CreateInviteInput = {}, now: number = Date.now()): IssuedInvite {
    const email = input.email === undefined || input.email === null ? null : normalizeEmail(input.email);
    if (email !== null && this.getUserByEmail(email) !== null) {
      throw conflict(`${email} already has an account`);
    }

    const token = newToken();
    const id = newInviteId(now);
    const days = input.expiresInDays ?? DEFAULT_INVITE_DAYS;
    this.#handle
      .prepare(
        `INSERT INTO invites (id, token_hash, email, role, created_by, created, expires, revoked, workspace_id)
         VALUES (@id, @hash, @email, @role, @by, @now, @expires, 0, @workspace)`,
      )
      .run({
        id,
        hash: hashToken(token),
        email,
        role: input.role ?? 'member',
        by: input.createdBy ?? null,
        now,
        expires: now + days * DAY_MS,
        workspace: input.workspaceId ?? null,
      });

    const invite = this.getInvite(id);
    if (invite === null) throw new Error('the invite vanished right after it was written');
    return { invite, token };
  }

  getInvite(id: string): Invite | null {
    const row = this.#handle.prepare('SELECT * FROM invites WHERE id = ?').get(id) as
      | InviteRow
      | undefined;
    return row === undefined ? null : toInvite(row);
  }

  /** The invite behind a link, or null when it is unknown, spent, revoked or expired. */
  getInviteByToken(token: string, now: number = Date.now()): Invite | null {
    const row = this.#handle.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hashToken(token)) as
      | InviteRow
      | undefined;
    if (row === undefined) return null;
    const invite = toInvite(row);
    if (invite.revoked || invite.acceptedBy !== null) return null;
    if (row.expires <= now) return null;
    return invite;
  }

  /** Every invite, newest first, including the spent ones so the UI can show what happened. */
  listInvites(): Invite[] {
    const rows = this.#handle
      .prepare('SELECT * FROM invites ORDER BY created DESC')
      .all() as InviteRow[];
    return rows.map(toInvite);
  }

  revokeInvite(id: string): Invite {
    const info = this.#handle.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').run(id);
    if (info.changes === 0) throw notFound(`No invite with id ${id}`);
    const invite = this.getInvite(id);
    if (invite === null) throw notFound(`No invite with id ${id}`);
    return invite;
  }

  /**
   * Turn an invite link into an account. The invite and the account are written together, so a
   * link can never create two accounts even when two tabs submit the form at the same moment.
   */
  redeemInvite(
    token: string,
    input: { email?: string; name: string; password: string },
    now: number = Date.now(),
  ): Account {
    const invite = this.getInviteByToken(token, now);
    if (invite === null) throw notFound('That invite link is not valid any more');

    // A pinned invite ignores whatever address the form carried; the link cannot be redirected.
    if (invite.email === null && input.email === undefined) {
      throw validation('An email address is required');
    }
    const email = invite.email ?? normalizeEmail(input.email ?? '');

    const run = this.#handle.transaction((): Account => {
      const account = this.createUser(
        { email, name: input.name, password: input.password, role: invite.role },
        now,
      );
      const info = this.#handle
        .prepare(
          `UPDATE invites SET accepted_by = ?, accepted = ? WHERE id = ? AND accepted_by IS NULL`,
        )
        .run(account.id, now, invite.id);
      if (info.changes === 0) throw conflict('That invite link was just used by somebody else');
      // The link decides which workspace the new person lands in. A link with none, the kind
      // the CLI mints, joins the first one: an account with no membership reaches nothing.
      const target = invite.workspaceId ?? this.listWorkspaces()[0]?.id ?? null;
      if (target !== null) this.addMember(target, account.id, invite.role, now);
      return account;
    });

    const account = run();
    this.#userCount = null;
    return account;
  }

  // -------------------------------------------------------------------------
  // agents
  // -------------------------------------------------------------------------

  /** Every agent in one workspace. Without a workspace, every agent on the install. */
  listAgents(workspaceId?: string): Agent[] {
    const rows =
      workspaceId === undefined
        ? (this.#handle
            .prepare(`SELECT ${AGENT_COLUMNS} FROM agents ORDER BY name COLLATE NOCASE`)
            .all() as AgentRow[])
        : (this.#handle
            .prepare(
              `SELECT ${AGENT_COLUMNS} FROM agents WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`,
            )
            .all(workspaceId) as AgentRow[]);
    return rows.map(toAgent);
  }

  getAgent(id: string): Agent | null {
    const row = this.#handle
      .prepare(`SELECT ${AGENT_COLUMNS} FROM agents WHERE id = ?`)
      .get(id) as AgentRow | undefined;
    return row === undefined ? null : toAgent(row);
  }

  getAgentByHandle(handle: string): Agent | null {
    const row = this.#handle
      .prepare(`SELECT ${AGENT_COLUMNS} FROM agents WHERE handle = ?`)
      .get(handle.trim().replace(/^@/, '').toLowerCase()) as AgentRow | undefined;
    return row === undefined ? null : toAgent(row);
  }

  /** Create an agent and issue its only credential. The token is never readable again. */
  createAgent(input: CreateAgentInput, now: number = Date.now()): IssuedAgent {
    const name = input.name.trim();
    if (name.length === 0) throw validation('A name is required');
    if (this.getWorkspace(input.workspaceId) === null) {
      throw notFound(`No workspace with id ${input.workspaceId}`);
    }

    const id = newAgentId(now);
    const handle = uniqueHandle(toHandle(input.handle ?? name), this.#handleTaken);
    const token = AGENT_TOKEN_PREFIX + newToken();
    this.#handle
      .prepare(
        `INSERT INTO agents (id, name, handle, identity, workspace_id, token_hash, disabled, created, updated)
         VALUES (@id, @name, @handle, @identity, @workspace, @hash, 0, @now, @now)`,
      )
      .run({
        id,
        name,
        handle,
        identity: input.identity?.trim() ?? '',
        workspace: input.workspaceId,
        hash: hashToken(token),
        now,
      });

    const agent = this.getAgent(id);
    if (agent === null) throw new Error('the agent vanished right after it was written');
    return { agent, token };
  }

  updateAgent(id: string, patch: UpdateAgentInput, now: number = Date.now()): Agent {
    const current = this.getAgent(id);
    if (current === null) throw notFound(`No agent with id ${id}`);

    // The handle stays: it is what an existing page means when it says `@handle`.
    const next = {
      name: patch.name?.trim() ?? current.name,
      identity: patch.identity?.trim() ?? current.identity,
      disabled: patch.disabled ?? current.disabled,
    };
    this.#handle
      .prepare(
        `UPDATE agents SET name = @name, identity = @identity, disabled = @disabled, updated = @now
         WHERE id = @id`,
      )
      .run({ id, name: next.name, identity: next.identity, disabled: next.disabled ? 1 : 0, now });

    const updated = this.getAgent(id);
    if (updated === null) throw notFound(`No agent with id ${id}`);
    return updated;
  }

  deleteAgent(id: string): void {
    const info = this.#handle.prepare('DELETE FROM agents WHERE id = ?').run(id);
    if (info.changes === 0) throw notFound(`No agent with id ${id}`);
  }

  /** Issue a fresh token and invalidate the old one at the same moment. */
  rotateAgentToken(id: string, now: number = Date.now()): IssuedAgent {
    const token = AGENT_TOKEN_PREFIX + newToken();
    const info = this.#handle
      .prepare('UPDATE agents SET token_hash = ?, updated = ? WHERE id = ?')
      .run(hashToken(token), now, id);
    if (info.changes === 0) throw notFound(`No agent with id ${id}`);

    const agent = this.getAgent(id);
    if (agent === null) throw notFound(`No agent with id ${id}`);
    return { agent, token };
  }

  /** The agent behind a token, or null when it is unknown or switched off. */
  resolveAgentToken(token: string, now: number = Date.now()): Agent | null {
    const row = this.#handle
      .prepare(`SELECT ${AGENT_COLUMNS} FROM agents WHERE token_hash = ?`)
      .get(hashToken(token)) as AgentRow | undefined;
    if (row === undefined) return null;
    const agent = toAgent(row);
    if (agent.disabled) return null;

    if (row.last_used === null || now - row.last_used > LAST_USED_INTERVAL_MS) {
      this.#handle.prepare('UPDATE agents SET last_used = ? WHERE id = ?').run(now, agent.id);
    }
    return agent;
  }

  // -------------------------------------------------------------------------
  // avatars
  // -------------------------------------------------------------------------

  /**
   * Store an avatar and return its new revision.
   * Avatars live here rather than in the content repo: they are not documentation, and a new
   * binary on every change would bloat the git history that the page files depend on.
   */
  setAvatar(id: string, mime: string, bytes: Buffer, now: number = Date.now()): string {
    if (!AVATAR_MIME_TYPES.includes(mime as (typeof AVATAR_MIME_TYPES)[number])) {
      throw validation(`An avatar must be one of ${AVATAR_MIME_TYPES.join(', ')}, got ${mime}`);
    }
    if (bytes.byteLength === 0) throw validation('The avatar upload is empty');
    if (bytes.byteLength > MAX_AVATAR_BYTES) {
      throw validation(`An avatar must be smaller than ${MAX_AVATAR_BYTES} bytes`);
    }

    const rev = digestOf(bytes);
    const info = this.#handle
      .prepare(
        `UPDATE users SET avatar_mime = ?, avatar_bytes = ?, avatar_rev = ?, updated = ? WHERE id = ?`,
      )
      .run(mime, bytes, rev, now, id);
    if (info.changes === 0) throw notFound(`No account with id ${id}`);
    return rev;
  }

  getAvatar(id: string): Avatar | null {
    const row = this.#handle
      .prepare('SELECT avatar_mime, avatar_bytes, avatar_rev FROM users WHERE id = ?')
      .get(id) as AvatarRow | undefined;
    if (row === undefined || row.avatar_mime === null || row.avatar_bytes === null) return null;
    return { mime: row.avatar_mime, bytes: row.avatar_bytes, rev: row.avatar_rev ?? digestOf(row.avatar_bytes) };
  }

  clearAvatar(id: string, now: number = Date.now()): void {
    const info = this.#handle
      .prepare(
        'UPDATE users SET avatar_mime = NULL, avatar_bytes = NULL, avatar_rev = NULL, updated = ? WHERE id = ?',
      )
      .run(now, id);
    if (info.changes === 0) throw notFound(`No account with id ${id}`);
  }

  // -------------------------------------------------------------------------
  // custom emoji
  // -------------------------------------------------------------------------

  /** Every custom emoji on this install, oldest first. Anybody who can read the site sees them. */
  listCustomEmoji(): CustomEmoji[] {
    const rows = this.#handle
      .prepare(`SELECT ${CUSTOM_EMOJI_COLUMNS} FROM custom_emoji ORDER BY created, id`)
      .all() as CustomEmojiRow[];
    return rows.map(toCustomEmoji);
  }

  getCustomEmoji(shortcode: string): CustomEmoji | null {
    const row = this.#handle
      .prepare(`SELECT ${CUSTOM_EMOJI_COLUMNS} FROM custom_emoji WHERE shortcode = ?`)
      .get(shortcode.trim().toLowerCase()) as CustomEmojiRow | undefined;
    return row === undefined ? null : toCustomEmoji(row);
  }

  /** The image behind a shortcode, or null when nobody has uploaded that name. */
  getCustomEmojiImage(shortcode: string): CustomEmojiImage | null {
    const row = this.#handle
      .prepare('SELECT mime, bytes FROM custom_emoji WHERE shortcode = ?')
      .get(shortcode.trim().toLowerCase()) as CustomEmojiImageRow | undefined;
    if (row === undefined) return null;
    return { mime: row.mime, bytes: row.bytes, rev: digestOf(row.bytes) };
  }

  /**
   * Store one custom emoji. The bytes decide the image type, because a browser is free to
   * declare whatever content type it likes.
   */
  createCustomEmoji(input: CreateCustomEmojiInput, now: number = Date.now()): CustomEmoji {
    const shortcode = input.shortcode.trim().toLowerCase();
    if (!isShortcode(shortcode)) {
      throw validation(
        `A shortcode uses lower-case letters, digits, "_" and "-", up to ${MAX_SHORTCODE_LENGTH} characters`,
      );
    }
    if (input.bytes.byteLength === 0) throw validation('The emoji upload is empty');
    if (input.bytes.byteLength > MAX_CUSTOM_EMOJI_BYTES) {
      throw validation(`A custom emoji must be smaller than ${MAX_CUSTOM_EMOJI_BYTES} bytes`);
    }

    const mime = sniffImageMime(input.bytes);
    if (mime === null) {
      throw validation(`A custom emoji must be one of ${CUSTOM_EMOJI_MIME_TYPES.join(', ')}`);
    }

    const id = newCustomEmojiId(now);
    try {
      this.#handle
        .prepare(
          `INSERT INTO custom_emoji (id, shortcode, mime, bytes, user_id, created)
           VALUES (@id, @shortcode, @mime, @bytes, @userId, @now)`,
        )
        .run({ id, shortcode, mime, bytes: input.bytes, userId: input.userId, now });
    } catch (cause) {
      if (!isUniqueViolation(cause)) throw cause;
      throw conflict(`:${shortcode}: is already taken`);
    }

    const created = this.getCustomEmoji(shortcode);
    if (created === null) throw new Error('the custom emoji vanished right after it was written');
    return created;
  }

  /** Delete one custom emoji. Only its uploader, or an admin, may do it. */
  deleteCustomEmoji(id: string, actor: CustomEmojiActor): void {
    const row = this.#handle
      .prepare(`SELECT ${CUSTOM_EMOJI_COLUMNS} FROM custom_emoji WHERE id = ?`)
      .get(id) as CustomEmojiRow | undefined;
    if (row === undefined) throw notFound(`No custom emoji with id ${id}`);
    if (!actor.admin && row.user_id !== actor.userId) {
      throw unauthorized('Only the person who uploaded an emoji, or an admin, can delete it');
    }
    this.#handle.prepare('DELETE FROM custom_emoji WHERE id = ?').run(id);
  }

  // -------------------------------------------------------------------------
  // slack
  // -------------------------------------------------------------------------

  /** The Slack member id this person has connected, or null. */
  getSlackUserId(id: string): string | null {
    const row = this.#handle.prepare('SELECT slack_user_id FROM users WHERE id = ?').get(id) as
      | { slack_user_id: string | null }
      | undefined;
    if (row === undefined) throw notFound(`No account with id ${id}`);
    return row.slack_user_id;
  }

  /** Connects Slack, or disconnects it with null. */
  setSlackUserId(id: string, slackUserId: string | null, now: number = Date.now()): void {
    const info = this.#handle
      .prepare('UPDATE users SET slack_user_id = ?, updated = ? WHERE id = ?')
      .run(slackUserId, now, id);
    if (info.changes === 0) throw notFound(`No account with id ${id}`);
  }
}

interface ColumnRow {
  name: string;
}

/** A UNIQUE index refused the write. Two uploads of one shortcode can race, so this is the guard. */
function isUniqueViolation(cause: unknown): boolean {
  if (!(cause instanceof Error) || !('code' in cause)) return false;
  return typeof cause.code === 'string' && cause.code.startsWith('SQLITE_CONSTRAINT');
}

function addColumn(db: Db, table: string, column: string, type: string): void {
  const columns = db.pragma(`table_info(${table})`) as ColumnRow[];
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** Gives every account written before mentions a handle, so the unique index can be built. */
function backfillHandles(db: Db): void {
  const rows = db
    .prepare("SELECT id, name, email FROM users WHERE handle IS NULL OR handle = ''")
    .all() as Array<{ id: string; name: string; email: string }>;
  if (rows.length === 0) return;

  const existing = db
    .prepare("SELECT handle FROM users WHERE handle IS NOT NULL AND handle != ''")
    .all() as Array<{ handle: string }>;
  const taken = new Set(existing.map((entry) => entry.handle));

  const update = db.prepare('UPDATE users SET handle = ? WHERE id = ?');
  for (const row of rows) {
    const named = toHandle(row.name);
    const base = named === 'user' ? toHandle(row.email.split('@')[0] ?? '') : named;
    const handle = uniqueHandle(base, (candidate) => taken.has(candidate));
    taken.add(handle);
    update.run(handle, row.id);
  }
}
