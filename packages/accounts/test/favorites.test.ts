import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FAVORITES, isAppError } from '@tablinum/shared';
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

const PAGE = 'pg_01J8XYZABCDEFGHJKMNPQRSTV';
const OTHER_PAGE = 'pg_01J8XYZABCDEFGHJKMNPQRSTW';

/** The error code an AppError carries, so a test can assert the wire behaviour. */
function codeOf(work: () => unknown): string {
  try {
    work();
  } catch (err) {
    return isAppError(err) ? err.code : `unexpected: ${String(err)}`;
  }
  return 'no error';
}

function workspace(accounts: AccountStore, name = 'Main', dir = '/content/main') {
  return accounts.createWorkspace({ name, dir });
}

/**
 * A pin belongs to a real account, because the foreign key takes the pins with the account when
 * it is deleted. A made-up user id is refused by SQLite, so every test makes the person first.
 */
function person(accounts: AccountStore, email: string, name: string): string {
  return accounts.createUser({ email, name, password: 'correct horse battery' }).id;
}

const ada = (accounts: AccountStore): string => person(accounts, 'ada@example.com', 'Ada Lovelace');
const grace = (accounts: AccountStore): string =>
  person(accounts, 'grace@example.com', 'Grace Hopper');

describe('favorites', () => {
  it('pins a page and lists it back', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);

    const favorite = accounts.addFavorite(main.id, me, PAGE);

    expect(favorite.pageId).toBe(PAGE);
    expect(accounts.listFavorites(main.id, me)).toEqual([favorite]);
  });

  it('keeps the pins in the order they were made', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);

    accounts.addFavorite(main.id, me, PAGE, 2000);
    accounts.addFavorite(main.id, me, OTHER_PAGE, 1000);

    expect(accounts.listFavorites(main.id, me).map((one) => one.pageId)).toEqual([
      OTHER_PAGE,
      PAGE,
    ]);
  });

  it('keeps the first stamp when the same page is pinned twice', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);

    const first = accounts.addFavorite(main.id, me, PAGE, 1000);
    const again = accounts.addFavorite(main.id, me, PAGE, 5000);

    expect(again).toEqual(first);
    expect(accounts.listFavorites(main.id, me)).toHaveLength(1);
  });

  it('keeps one person out of the pins of another', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);
    const other = grace(accounts);

    accounts.addFavorite(main.id, me, PAGE);

    expect(accounts.listFavorites(main.id, other)).toEqual([]);
  });

  it('keeps the pins of one workspace out of another', () => {
    const accounts = store();
    const main = workspace(accounts);
    const second = workspace(accounts, 'Other', '/content/other');
    const me = ada(accounts);

    accounts.addFavorite(main.id, me, PAGE);

    expect(accounts.listFavorites(second.id, me)).toEqual([]);
  });

  it('takes a pin off again', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);
    accounts.addFavorite(main.id, me, PAGE);

    expect(accounts.removeFavorite(main.id, me, PAGE)).toBe(true);
    expect(accounts.listFavorites(main.id, me)).toEqual([]);
  });

  it('says nothing changed when the page was never pinned', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);

    expect(accounts.removeFavorite(main.id, me, PAGE)).toBe(false);
  });

  it('takes the pins with the account that made them', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);
    accounts.addFavorite(main.id, me, PAGE);

    accounts.deleteUser(me);

    expect(accounts.listFavorites(main.id, me)).toEqual([]);
  });

  it('refuses a workspace that does not exist', () => {
    const accounts = store();
    const me = ada(accounts);

    expect(codeOf(() => accounts.addFavorite('ws_nope', me, PAGE))).toBe('NOT_FOUND');
  });

  it('refuses an empty page id', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);

    expect(codeOf(() => accounts.addFavorite(main.id, me, '   '))).toBe('VALIDATION');
  });

  it('refuses a pin past the cap', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);
    for (let index = 0; index < MAX_FAVORITES; index += 1) {
      accounts.addFavorite(main.id, me, `pg_${String(index).padStart(26, '0')}`);
    }

    expect(codeOf(() => accounts.addFavorite(main.id, me, PAGE))).toBe('VALIDATION');
    expect(accounts.listFavorites(main.id, me)).toHaveLength(MAX_FAVORITES);
  });

  it('drops the pins of deleted pages, for everybody', () => {
    const accounts = store();
    const main = workspace(accounts);
    const me = ada(accounts);
    const other = grace(accounts);
    accounts.addFavorite(main.id, me, PAGE);
    accounts.addFavorite(main.id, other, PAGE);
    accounts.addFavorite(main.id, me, OTHER_PAGE);

    expect(accounts.deleteFavoritesForPages(main.id, [PAGE])).toBe(2);
    expect(accounts.listFavorites(main.id, me).map((one) => one.pageId)).toEqual([OTHER_PAGE]);
    expect(accounts.listFavorites(main.id, other)).toEqual([]);
  });
});
