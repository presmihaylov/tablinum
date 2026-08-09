import { validation } from './errors.js';
import type { Config } from './types.js';

export type EnvSource = Record<string, string | undefined>;

export const DEFAULT_CONTENT_DIR = '/Users/pmihaylov/prg/repos/tablinum/.data/content';
export const DEFAULT_PORT = 4000;
export const DEFAULT_GIT_BRANCH = 'main';
export const DEFAULT_GIT_AUTHOR_NAME = 'tablinum';
export const DEFAULT_GIT_AUTHOR_EMAIL = 'tablinum@localhost';
export const DEFAULT_AUTOCOMMIT_MS = 5000;
export const DEFAULT_AUTOPULL_MS = 60000;
export const DEFAULT_AUTOPUSH_MS = 5000;

/** Every environment variable tablinum reads. */
export const ENV_KEYS = [
  'TABLINUM_CONTENT_DIR',
  'TABLINUM_PORT',
  'TABLINUM_API_TOKENS',
  'TABLINUM_SESSION_SECRET',
  'TABLINUM_GIT_REMOTE',
  'TABLINUM_GIT_BRANCH',
  'TABLINUM_GIT_AUTHOR_NAME',
  'TABLINUM_GIT_AUTHOR_EMAIL',
  'TABLINUM_AUTOCOMMIT_MS',
  'TABLINUM_AUTOPULL_MS',
  'TABLINUM_AUTOPUSH_MS',
  'TABLINUM_SLACK_BOT_TOKEN',
  'TABLINUM_PUBLIC_URL',
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

// Kept string-only so @tablinum/shared stays free of node:path and bundles for the browser.
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
 * Read every tablinum environment variable, apply defaults and validate.
 * Throws a VALIDATION AppError with a readable message on any bad value.
 */
export function loadConfig(env: EnvSource = process.env): Config {
  const contentDir = read(env, 'TABLINUM_CONTENT_DIR') ?? DEFAULT_CONTENT_DIR;
  if (!isAbsolutePath(contentDir)) {
    throw validation(`TABLINUM_CONTENT_DIR must be an absolute path, got ${JSON.stringify(contentDir)}`);
  }

  const port = readInt(env, 'TABLINUM_PORT', DEFAULT_PORT, 1, 65535);
  const apiTokens = parseTokens(read(env, 'TABLINUM_API_TOKENS'));

  // Without a configured secret every restart invalidates existing sessions. That is safer
  // than shipping a fixed fallback secret.
  const sessionSecret = read(env, 'TABLINUM_SESSION_SECRET') ?? randomHex(32);
  if (sessionSecret.length < 16) {
    throw validation('TABLINUM_SESSION_SECRET must be at least 16 characters');
  }

  const gitBranch = read(env, 'TABLINUM_GIT_BRANCH') ?? DEFAULT_GIT_BRANCH;
  if (/\s/.test(gitBranch)) {
    throw validation(`TABLINUM_GIT_BRANCH must not contain whitespace, got ${JSON.stringify(gitBranch)}`);
  }

  const gitAuthorEmail = read(env, 'TABLINUM_GIT_AUTHOR_EMAIL') ?? DEFAULT_GIT_AUTHOR_EMAIL;
  if (!gitAuthorEmail.includes('@')) {
    throw validation(`TABLINUM_GIT_AUTHOR_EMAIL must be an email address, got ${JSON.stringify(gitAuthorEmail)}`);
  }

  // A Slack message links back to the page, and Slack cannot resolve "localhost".
  const publicUrl = read(env, 'TABLINUM_PUBLIC_URL') ?? null;
  if (publicUrl !== null && !/^https?:\/\//.test(publicUrl)) {
    throw validation(`TABLINUM_PUBLIC_URL must start with http:// or https://, got ${JSON.stringify(publicUrl)}`);
  }

  const config: Config = {
    contentDir: contentDir.replace(/\/+$/, '') || '/',
    port,
    apiTokens: [...apiTokens],
    sessionSecret,
    gitRemote: read(env, 'TABLINUM_GIT_REMOTE') ?? null,
    gitBranch,
    gitAuthorName: read(env, 'TABLINUM_GIT_AUTHOR_NAME') ?? DEFAULT_GIT_AUTHOR_NAME,
    gitAuthorEmail,
    autocommitMs: readInt(env, 'TABLINUM_AUTOCOMMIT_MS', DEFAULT_AUTOCOMMIT_MS, 0, 3600000),
    autopullMs: readInt(env, 'TABLINUM_AUTOPULL_MS', DEFAULT_AUTOPULL_MS, 0, 86400000),
    autopushMs: readInt(env, 'TABLINUM_AUTOPUSH_MS', DEFAULT_AUTOPUSH_MS, 0, 3600000),
    slackBotToken: read(env, 'TABLINUM_SLACK_BOT_TOKEN') ?? null,
    publicUrl: publicUrl === null ? null : publicUrl.replace(/\/+$/, ''),
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
    sessionSecret: 'set',
    gitRemote: config.gitRemote,
    gitBranch: config.gitBranch,
    gitAuthorName: config.gitAuthorName,
    gitAuthorEmail: config.gitAuthorEmail,
    autocommitMs: config.autocommitMs,
    autopullMs: config.autopullMs,
    autopushMs: config.autopushMs,
    slackBotToken: config.slackBotToken === null ? 'unset' : 'set',
    publicUrl: config.publicUrl,
  };
}
