import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from node:crypto, so accounts add no new dependency.
 * The encoded form carries its own parameters, which is what lets them be raised later
 * without invalidating every stored hash.
 */

const SCHEME = 'scrypt';
const COST = 16_384; // N
const BLOCK_SIZE = 8; // r
const PARALLEL = 1; // p
const KEY_LENGTH = 32;
const SALT_BYTES = 16;

/** scrypt needs 128 * N * r bytes; the node default of 32 MiB is not quite enough headroom. */
const MAX_MEMORY = 64 * 1024 * 1024;

interface Params {
  cost: number;
  blockSize: number;
  parallel: number;
}

function derive(password: string, salt: Buffer, params: Params, keyLength: number): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, keyLength, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallel,
    maxmem: MAX_MEMORY,
  });
}

/** Encode a password as `scrypt$N$r$p$salt$hash`, both parts base64. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const params: Params = { cost: COST, blockSize: BLOCK_SIZE, parallel: PARALLEL };
  const hash = derive(password, salt, params, KEY_LENGTH);
  return [
    SCHEME,
    params.cost,
    params.blockSize,
    params.parallel,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

function parse(encoded: string): { params: Params; salt: Buffer; hash: Buffer } | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== SCHEME) return null;
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallel = Number(parts[3]);
  if (![cost, blockSize, parallel].every((value) => Number.isInteger(value) && value > 0)) return null;
  try {
    const salt = Buffer.from(parts[4] ?? '', 'base64');
    const hash = Buffer.from(parts[5] ?? '', 'base64');
    if (salt.length === 0 || hash.length === 0) return null;
    return { params: { cost, blockSize, parallel }, salt, hash };
  } catch {
    return null;
  }
}

/** True when the password produces the stored hash. Constant time for a well-formed hash. */
export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = parse(encoded);
  if (parsed === null) return false;
  const candidate = derive(password, parsed.salt, parsed.params, parsed.hash.length);
  return timingSafeEqual(candidate, parsed.hash);
}

/**
 * A hash of a password nobody knows. Verifying against it makes a login for an address that
 * has no account cost the same as one that does, so the reply cannot be used to find members.
 */
export const DECOY_HASH = hashPassword(randomBytes(32).toString('base64'));
