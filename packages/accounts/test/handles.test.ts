import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { isAppError } from '@gitdocs/shared';
import { AccountStore } from '../src/store.js';

const open: AccountStore[] = [];
const dirs: string[] = [];

function store(dbPath = ':memory:'): AccountStore {
  const created = new AccountStore({ dbPath });
  created.init();
  open.push(created);
  return created;
}

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitdocs-accounts-'));
  dirs.push(dir);
  return join(dir, 'accounts.db');
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
  while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true });
});

const PASSWORD = 'a long enough passphrase';

function codeOf(work: () => unknown): string {
  try {
    work();
  } catch (err) {
    return isAppError(err) ? err.code : `unexpected: ${String(err)}`;
  }
  return 'no error';
}

/** The version 1 users table, as it stood before mentions existed. */
function writeVersionOne(dbPath: string, rows: Array<{ id: string; email: string; name: string }>): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
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
  `);
  const insert = db.prepare(
    `INSERT INTO users (id, email, name, role, color, password_hash, disabled, created, updated)
     VALUES (?, ?, ?, 'member', '#123456', 'x', 0, 1, 1)`,
  );
  for (const row of rows) insert.run(row.id, row.email, row.name);
  db.pragma('user_version = 1');
  db.close();
}

describe('handles', () => {
  it('derives a handle from the display name', () => {
    const accounts = store();
    const ada = accounts.createUser({ email: 'ada@example.com', name: 'Ada Lovelace', password: PASSWORD });
    expect(ada.handle).toBe('ada.lovelace');
    expect(accounts.getUserByHandle('ada.lovelace')?.id).toBe(ada.id);
  });

  it('falls back to the email local part when the name gives nothing', () => {
    const accounts = store();
    const created = accounts.createUser({ email: 'grace@example.com', name: '***', password: PASSWORD });
    expect(created.handle).toBe('grace');
  });

  it('gives a second person with the same name a suffixed handle', () => {
    const accounts = store();
    const first = accounts.createUser({ email: 'a@example.com', name: 'Ada Lovelace', password: PASSWORD });
    const second = accounts.createUser({ email: 'b@example.com', name: 'Ada Lovelace', password: PASSWORD });
    expect(first.handle).toBe('ada.lovelace');
    expect(second.handle).toBe('ada.lovelace.2');
  });

  it('accepts an explicit handle and suffixes it when it is taken', () => {
    const accounts = store();
    accounts.createUser({ email: 'a@example.com', name: 'Ada', password: PASSWORD, handle: 'ada' });
    expect(accounts.getUserByHandle('ada')?.email).toBe('a@example.com');

    const second = accounts.createUser({
      email: 'b@example.com',
      name: 'Other',
      password: PASSWORD,
      handle: '@ADA',
    });
    expect(second.handle).toBe('ada.2');
  });

  it('keeps the handle when the display name changes', () => {
    const accounts = store();
    const created = accounts.createUser({ email: 'a@example.com', name: 'Ada Lovelace', password: PASSWORD });
    const renamed = accounts.updateUser(created.id, { name: 'Ada King' });
    expect(renamed.handle).toBe('ada.lovelace');
  });

  it('finds nobody for an unknown handle', () => {
    expect(store().getUserByHandle('nobody')).toBeNull();
  });
});

describe('migration from version 1', () => {
  it('gives every old account a handle, without a collision', () => {
    const dbPath = tempDb();
    writeVersionOne(dbPath, [
      { id: 'us_1', email: 'a@example.com', name: 'Ada Lovelace' },
      { id: 'us_2', email: 'b@example.com', name: 'Ada Lovelace' },
      { id: 'us_3', email: 'grace@example.com', name: '***' },
    ]);

    const accounts = store(dbPath);
    const handles = accounts.listUsers().map((user) => user.handle);
    expect(new Set(handles).size).toBe(3);
    expect(handles).toContain('ada.lovelace');
    expect(handles).toContain('ada.lovelace.2');
    expect(handles).toContain('grace');
  });

  it('leaves the handles alone when the store opens a second time', () => {
    const dbPath = tempDb();
    writeVersionOne(dbPath, [{ id: 'us_1', email: 'a@example.com', name: 'Ada Lovelace' }]);

    const first = store(dbPath);
    const before = first.getUser('us_1')?.handle;
    first.close();
    open.pop();

    expect(store(dbPath).getUser('us_1')?.handle).toBe(before);
  });
});

describe('slack', () => {
  it('starts disconnected, connects and disconnects again', () => {
    const accounts = store();
    const ada = accounts.createUser({ email: 'a@example.com', name: 'Ada', password: PASSWORD });
    expect(accounts.getSlackUserId(ada.id)).toBeNull();

    accounts.setSlackUserId(ada.id, 'U01ABCDEF');
    expect(accounts.getSlackUserId(ada.id)).toBe('U01ABCDEF');

    accounts.setSlackUserId(ada.id, null);
    expect(accounts.getSlackUserId(ada.id)).toBeNull();
  });

  it('reports an unknown account', () => {
    const accounts = store();
    expect(codeOf(() => accounts.getSlackUserId('us_missing'))).toBe('NOT_FOUND');
    expect(codeOf(() => accounts.setSlackUserId('us_missing', 'U01ABCDEF'))).toBe('NOT_FOUND');
  });
});
