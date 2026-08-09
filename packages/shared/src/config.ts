import { validation } from './errors.js';
import type { Config } from './types.js';

export type EnvSource = Record<string, string | undefined>;

export const DEFAULT_CONTENT_DIR = '/Users/pmihaylov/prg/repos/gitdocs/.data/content';
export const DEFAULT_PORT = 4000;
export const DEFAULT_GIT_BRANCH = 'main';
export const DEFAULT_GIT_AUTHOR_NAME = 'gitdocs';
export const DEFAULT_GIT_AUTHOR_EMAIL = 'gitdocs@localhost';
export const DEFAULT_AUTOCOMMIT_MS = 5000;
export const DEFAULT_AUTOPULL_MS = 60000;
export const DEFAULT_AUTOPUSH_MS = 5000;

/** Every environment variable gitdocs reads. */
export const ENV_KEYS = [
  'GITDOCS_CONTENT_DIR',
  'GITDOCS_PORT',
  'GITDOCS_API_TOKENS',
  'GITDOCS_PASSWORD',
  'GITDOCS_SESSION_SECRET',
  'GITDOCS_GIT_REMOTE',
  'GITDOCS_GIT_BRANCH',
  'GITDOCS_GIT_AUTHOR_NAME',
  'GITDOCS_GIT_AUTHOR_EMAIL',
  'GITDOCS_AUTOCOMMIT_MS',
  'GITDOCS_AUTOPULL_MS',
  'GITDOCS_AUTOPUSH_MS',
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

function read(env: EnvSource, key: EnvKey): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function readInt(env: EnvSource, key: EnvKey, fallback: number, min: number, max: number): number {
  const raw = read(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw validation(`${key} must be an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

// Kept string-only so @gitdocs/shared stays free of node:path and bundles for the browser.
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || WINDOWS_ABSOLUTE_RE.test(value);
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseTokens(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return [...new Set(tokens)];
}

/**
 * Read every gitdocs environment variable, apply defaults and validate.
 * Throws a VALIDATION AppError with a readable message on any bad value.
 */
export function loadConfig(env: EnvSource = process.env): Config {
  const contentDir = read(env, 'GITDOCS_CONTENT_DIR') ?? DEFAULT_CONTENT_DIR;
  if (!isAbsolutePath(contentDir)) {
    throw validation(`GITDOCS_CONTENT_DIR must be an absolute path, got ${JSON.stringify(contentDir)}`);
  }

  const port = readInt(env, 'GITDOCS_PORT', DEFAULT_PORT, 1, 65535);
  const apiTokens = parseTokens(read(env, 'GITDOCS_API_TOKENS'));
  const password = read(env, 'GITDOCS_PASSWORD') ?? null;

  // Without a configured secret every restart invalidates existing sessions. That is safer
  // than shipping a fixed fallback secret.
  const sessionSecret = read(env, 'GITDOCS_SESSION_SECRET') ?? randomHex(32);
  if (sessionSecret.length < 16) {
    throw validation('GITDOCS_SESSION_SECRET must be at least 16 characters');
  }

  const gitBranch = read(env, 'GITDOCS_GIT_BRANCH') ?? DEFAULT_GIT_BRANCH;
  if (/\s/.test(gitBranch)) {
    throw validation(`GITDOCS_GIT_BRANCH must not contain whitespace, got ${JSON.stringify(gitBranch)}`);
  }

  const gitAuthorEmail = read(env, 'GITDOCS_GIT_AUTHOR_EMAIL') ?? DEFAULT_GIT_AUTHOR_EMAIL;
  if (!gitAuthorEmail.includes('@')) {
    throw validation(`GITDOCS_GIT_AUTHOR_EMAIL must be an email address, got ${JSON.stringify(gitAuthorEmail)}`);
  }

  const config: Config = {
    contentDir: contentDir.replace(/\/+$/, '') || '/',
    port,
    apiTokens: [...apiTokens],
    password,
    sessionSecret,
    gitRemote: read(env, 'GITDOCS_GIT_REMOTE') ?? null,
    gitBranch,
    gitAuthorName: read(env, 'GITDOCS_GIT_AUTHOR_NAME') ?? DEFAULT_GIT_AUTHOR_NAME,
    gitAuthorEmail,
    autocommitMs: readInt(env, 'GITDOCS_AUTOCOMMIT_MS', DEFAULT_AUTOCOMMIT_MS, 0, 3600000),
    autopullMs: readInt(env, 'GITDOCS_AUTOPULL_MS', DEFAULT_AUTOPULL_MS, 0, 86400000),
    autopushMs: readInt(env, 'GITDOCS_AUTOPUSH_MS', DEFAULT_AUTOPUSH_MS, 0, 3600000),
    openMode: apiTokens.length === 0 && password === null,
  };

  return Object.freeze(config);
}

let cached: Config | null = null;

/** Load the config once per process. Every package should use this. */
export function getConfig(env?: EnvSource): Config {
  if (cached === null) cached = loadConfig(env);
  return cached;
}

/** Drop the memoized config. Tests use this; production code should not need it. */
export function resetConfigCache(): void {
  cached = null;
}

/** Config with every secret masked, safe to log. */
export function redactConfig(config: Config): Record<string, string | number | boolean | null> {
  return {
    contentDir: config.contentDir,
    port: config.port,
    apiTokens: config.apiTokens.length === 0 ? 'none' : `${config.apiTokens.length} token(s)`,
    password: config.password === null ? 'unset' : 'set',
    sessionSecret: 'set',
    gitRemote: config.gitRemote,
    gitBranch: config.gitBranch,
    gitAuthorName: config.gitAuthorName,
    gitAuthorEmail: config.gitAuthorEmail,
    autocommitMs: config.autocommitMs,
    autopullMs: config.autopullMs,
    autopushMs: config.autopushMs,
    openMode: config.openMode,
  };
}

export const OPEN_MODE_WARNING =
  'gitdocs is running in OPEN mode: GITDOCS_API_TOKENS and GITDOCS_PASSWORD are both unset, ' +
  'so every REST and MCP endpoint is unauthenticated. Do not expose this port to a network.';
