import type Database from 'better-sqlite3';

/** The open handle. store.ts and comments.ts both take one rather than opening their own. */
export type Db = Database.Database;

/** A stamp is epoch milliseconds in the file and an ISO string on the wire. */
export const iso = (ms: number): string => new Date(ms).toISOString();
