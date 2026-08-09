# @tablinum/accounts

The account database: users, passwords, sessions, invite links and avatars, in SQLite.

## Why it is a second database

The content directory is a git repo of markdown. Passwords, session tokens and avatar
binaries are none of those things, so they never go near it. The file sits beside the search
index (`accounts.db` next to `search.db`, one level above the content root), which keeps it
out of every commit and off every git remote.

Unlike the search index, this database is **not** rebuildable. Back it up.

## What is stored

| table | holds |
| --- | --- |
| `users` | id, email, display name, role, presence colour, password hash, avatar blob |
| `sessions` | one row per signed-in browser, keyed by the hash of the session token |
| `invites` | one row per invite link, keyed by the hash of the invite token |

Passwords use `scrypt` from `node:crypto` (N=16384, r=8, p=1), encoded as
`scrypt$N$r$p$salt$hash`. The parameters travel with the hash, so they can be raised later
without invalidating what is already stored.

Session and invite tokens are stored as their SHA-256 hash only. A copy of the database
therefore yields no working session and no usable invite link.

## Roles

`admin` invites people, changes roles and removes accounts. `member` reads and writes every
page. There is no per-page permission, because the content is one git repo.

The store refuses to demote, disable or delete the last enabled admin.

## Usage

```ts
import { AccountStore, defaultAccountsDbPath } from '@tablinum/accounts';

const accounts = new AccountStore({ dbPath: defaultAccountsDbPath(contentDir) });
accounts.init();

const admin = accounts.createUser({
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  password: 'a long enough passphrase',
  role: 'admin',
});

const { token } = accounts.createInvite({ role: 'member', createdBy: admin.id });
// send `/invite/${token}`; the token is never readable again

const session = accounts.createSession(admin.id);
accounts.resolveSession(session.token); // -> the account
```

Every method is synchronous, because better-sqlite3 is.
