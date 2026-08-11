import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../src/store.js';

/**
 * Upgrades, not fresh installs.
 *
 * A fresh file gets every column from CREATE TABLE, so a missed migration never shows up there.
 * These tests all start from a file that an older build left behind.
 */

const dirs: string[] = [];
const open: AccountStore[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'accounts-migrate-'));
  dirs.push(dir);
  return dir;
}

function opened(dbPath: string): AccountStore {
  const store = new AccountStore({ dbPath });
  store.init();
  open.push(store);
  return store;
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
  while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true });
});

function columnsOf(dbPath: string, table: string): string[] {
  const db = new Database(dbPath);
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  db.close();
  return rows.map((row) => row.name).sort();
}

/** A file an older build left behind: the column is gone and the stamp says it is current. */
function rollBack(dbPath: string, table: string, column: string, version: number): void {
  const db = new Database(dbPath);
  db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  db.pragma(`user_version = ${version}`);
  db.close();
}

/** The same, for a whole table an older build never had. */
function dropTable(dbPath: string, table: string, version: number): void {
  const db = new Database(dbPath);
  db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.pragma(`user_version = ${version}`);
  db.close();
}

/** A database this build made, closed and ready to be aged. */
function seeded(): { dbPath: string; dir: string; workspaceId: string } {
  const dir = scratch();
  const dbPath = join(dir, 'accounts.db');
  const store = new AccountStore({ dbPath });
  store.init();
  const workspace = store.ensureWorkspaceForDir(dir, 'Main', 'main');
  store.close();
  return { dbPath, dir, workspaceId: workspace.id };
}

function versionOf(dbPath: string): number {
  const db = new Database(dbPath);
  const found = db.pragma('user_version', { simple: true });
  db.close();
  return typeof found === 'number' ? found : 0;
}

describe('AccountStore migration', () => {
  it('adds a missing column even when the file is already stamped current', () => {
    const { dbPath, workspaceId } = seeded();
    const wanted = columnsOf(dbPath, 'agents');
    rollBack(dbPath, 'agents', 'webhook_url', versionOf(dbPath));

    const store = opened(dbPath);

    expect(columnsOf(dbPath, 'agents')).toEqual(wanted);
    const made = store.createAgent({ name: 'Doc Bot', workspaceId });
    expect(store.getAgent(made.agent.id)?.webhookUrl).toBeNull();
  });

  it('serves an agent from a file written before webhooks existed', () => {
    const { dbPath, workspaceId } = seeded();
    rollBack(dbPath, 'agents', 'webhook_url', 7);

    const store = opened(dbPath);
    const made = store.createAgent({
      name: 'Doc Bot',
      workspaceId,
      webhookUrl: 'https://bot.example.com/hook',
    });

    expect(made.agent.webhookUrl).toBe('https://bot.example.com/hook');
    expect(store.listAgents(workspaceId)).toHaveLength(1);
    expect(store.updateAgent(made.agent.id, { webhookUrl: null }).webhookUrl).toBeNull();
  });

  it('restores every column an older build could be missing', () => {
    const { dbPath, workspaceId } = seeded();
    const wanted = columnsOf(dbPath, 'agents');
    for (const column of ['webhook_url', 'avatar_mime', 'avatar_bytes', 'avatar_rev']) {
      rollBack(dbPath, 'agents', column, 3);
    }

    const store = opened(dbPath);

    expect(columnsOf(dbPath, 'agents')).toEqual(wanted);
    expect(() => store.createAgent({ name: 'Doc Bot', workspaceId })).not.toThrow();
  });

  it('adds handle_changed to a file written before the handle could be changed', () => {
    const { dbPath } = seeded();
    const wanted = columnsOf(dbPath, 'users');
    rollBack(dbPath, 'users', 'handle_changed', 8);

    const store = opened(dbPath);

    expect(columnsOf(dbPath, 'users')).toEqual(wanted);
    const ada = store.createUser({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      password: 'a long enough passphrase',
    });
    expect(store.handleChangeableAt(ada.id)).toBeNull();
    expect(store.changeHandle(ada.id, 'ada.king').account.handle).toBe('ada.king');
  });

  it('gives an older file the reservations table, so an old handle stays taken', () => {
    const { dbPath } = seeded();
    dropTable(dbPath, 'handle_reservations', 8);

    const store = opened(dbPath);
    const ada = store.createUser({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      password: 'a long enough passphrase',
    });
    store.changeHandle(ada.id, 'ada.king');

    expect(store.getUserByHandle('ada.lovelace')?.id).toBe(ada.id);
  });

  it('leaves an already current file alone', () => {
    const { dbPath, workspaceId } = seeded();
    const first = opened(dbPath);
    const made = first.createAgent({ name: 'Doc Bot', workspaceId });
    first.close();
    open.pop();

    const again = opened(dbPath);

    expect(again.getAgent(made.agent.id)?.name).toBe('Doc Bot');
    expect(again.listAgents(workspaceId)).toHaveLength(1);
  });
});
