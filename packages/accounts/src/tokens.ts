import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Session and invite tokens.
 *
 * Only the hash is stored. A stolen database therefore yields no working session and no
 * working invite link, which is the same reason the passwords are hashed.
 */

const TOKEN_BYTES = 32;

/** A fresh, url-safe token. The caller shows it once and then only ever holds its hash. */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The stored form of a token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A short, stable fingerprint of some bytes. Used as the cache-busting avatar revision. */
export function digestOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** Constant-time comparison of two hex digests of the same length. */
export function digestEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
