import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/passwords.js';
import { digestEquals, digestOf, hashToken, newToken } from '../src/tokens.js';

describe('password hashing', () => {
  it('accepts the password it hashed and rejects anything else', () => {
    const encoded = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', encoded)).toBe(true);
    expect(verifyPassword('correct horse battery stapl', encoded)).toBe(false);
    expect(verifyPassword('', encoded)).toBe(false);
  });

  it('salts every hash, so the same password never looks the same twice', () => {
    const first = hashPassword('the same password');
    const second = hashPassword('the same password');
    expect(first).not.toBe(second);
    expect(verifyPassword('the same password', first)).toBe(true);
    expect(verifyPassword('the same password', second)).toBe(true);
  });

  it('carries its parameters, so they can be raised later', () => {
    const [scheme, cost, blockSize, parallel] = hashPassword('x'.repeat(12)).split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(cost)).toBeGreaterThanOrEqual(16_384);
    expect(Number(blockSize)).toBe(8);
    expect(Number(parallel)).toBe(1);
  });

  it('treats a password that looks different but normalizes the same as equal', () => {
    // "é" written as one code point and as "e" plus a combining accent.
    const encoded = hashPassword('passéphrase long');
    expect(verifyPassword('passéphrase long', encoded)).toBe(true);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    for (const bad of ['', 'nonsense', 'scrypt$1', 'bcrypt$1$2$3$c2FsdA==$aGFzaA==', 'scrypt$0$8$1$c2FsdA==$aGFzaA==']) {
      expect(verifyPassword('anything', bad)).toBe(false);
    }
  });
});

describe('tokens', () => {
  it('mints url-safe tokens that never repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(seen.size).toBe(200);
    for (const token of seen) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes a token to a stable digest that is not the token', () => {
    const token = newToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprints bytes and compares digests in constant time', () => {
    const rev = digestOf(Buffer.from('avatar bytes'));
    expect(rev).toMatch(/^[0-9a-f]{16}$/);
    expect(digestOf(Buffer.from('avatar bytes'))).toBe(rev);
    expect(digestOf(Buffer.from('other bytes'))).not.toBe(rev);

    expect(digestEquals(rev, rev)).toBe(true);
    expect(digestEquals(rev, 'ffffffffffffffff')).toBe(false);
    expect(digestEquals(rev, 'short')).toBe(false);
  });
});
