import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { AccountStore, defaultAccountsDbPath } from '@tablinum/accounts';
import {
  DEFAULT_INVITE_DAYS,
  MIN_PASSWORD_LENGTH,
  isAppError,
  loadConfig,
  type AccountRole,
} from '@tablinum/shared';

/**
 * The way back in when nobody can sign in: the browser cannot reset a password without a
 * password, so this runs on the server that owns the file.
 *
 *   node apps/server/dist/accounts-cli.js list
 */

export const USAGE = `tablinum accounts

  list                                  every account, with its role
  promote <email>                       make somebody an admin
  demote <email>                        make somebody a member
  reset-password <email> [password]     set a password; one is generated when you omit it
  invite [email] [--role r] [--days n]  create an invite token
  delete <email>                        remove an account

The file is <parent of TABLINUM_CONTENT_DIR>/accounts.db. The server may keep running.`;

/** Thrown, not exited, so the database is still closed on the way out. */
class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

/** A generated password nobody has to remember, because it is changed on first sign-in. */
function newPassword(): string {
  return randomBytes(18).toString('base64url');
}

function readRole(args: string[]): AccountRole {
  const at = args.indexOf('--role');
  if (at === -1) return 'member';
  const value = args[at + 1];
  if (value !== 'admin' && value !== 'member') fail('--role takes "admin" or "member"');
  return value;
}

function readDays(args: string[]): number {
  const at = args.indexOf('--days');
  if (at === -1) return DEFAULT_INVITE_DAYS;
  const value = Number(args[at + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 90) fail('--days takes 1 to 90');
  return value;
}

function findUser(store: AccountStore, email: string | undefined): string {
  if (email === undefined) fail('Name an account by its email address');
  const account = store.getUserByEmail(email);
  if (account === null) fail(`No account for ${email}`);
  return account.id;
}

/** Where the commands write. The real one is the console; a test passes an array. */
export type Say = (line: string) => void;

export function run(store: AccountStore, argv: string[], say: Say): void {
  const [command, ...rest] = argv;
  const email = rest[0];

  if (command === 'list') {
    const users = store.listUsers();
    if (users.length === 0) {
      say('No accounts yet. The setup screen makes the first one.');
      return;
    }
    for (const user of users) {
      const state = user.disabled ? ' (disabled)' : '';
      say(`${user.role.padEnd(6)} ${user.email.padEnd(32)} ${user.name}${state}`);
    }
    return;
  }

  if (command === 'promote' || command === 'demote') {
    const role: AccountRole = command === 'promote' ? 'admin' : 'member';
    const user = store.updateUser(findUser(store, email), { role });
    say(`Role of ${user.email} is now ${user.role}`);
    return;
  }

  if (command === 'reset-password') {
    const id = findUser(store, email);
    const password = rest[1] ?? newPassword();
    if (password.length < MIN_PASSWORD_LENGTH) {
      fail(`A password needs at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    store.setPassword(id, password);
    // Whoever held the old password keeps a live cookie otherwise.
    store.destroySessionsFor(id);
    say(`Password for ${email} is now: ${password}`);
    say('Every session for that account is signed out. Change it after you sign in.');
    return;
  }

  if (command === 'invite') {
    const pinned = email !== undefined && !email.startsWith('--') ? email : null;
    const issued = store.createInvite({
      email: pinned,
      role: readRole(rest),
      expiresInDays: readDays(rest),
    });
    say(`Token:   ${issued.token}`);
    say(`Open:    <your tablinum url>/invite/${issued.token}`);
    say(`Role:    ${issued.invite.role}`);
    say(`Expires: ${issued.invite.expires}`);
    return;
  }

  if (command === 'delete') {
    const id = findUser(store, email);
    store.deleteUser(id);
    say(`${email} is removed. Their pages are untouched.`);
    return;
  }

  fail(USAGE);
}

/** Runs a command against the real database and returns the process exit code. */
export function main(argv: string[]): number {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE);
    return 0;
  }

  const store = new AccountStore({ dbPath: defaultAccountsDbPath(loadConfig().contentDir) });
  store.init();

  let failure: string | null = null;
  try {
    run(store, argv, (line) => console.log(line));
  } catch (cause) {
    // A store rule ("this is the only admin") is an answer, not a crash. Anything else is a bug.
    if (!(cause instanceof CliError || isAppError(cause))) throw cause;
    failure = cause.message;
  } finally {
    store.close();
  }

  if (failure === null) return 0;
  console.error(failure);
  return 1;
}

// Only act when this file is the entry point, so importing it stays side-effect free.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2));
}
