import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT_SUBDIR,
  getConfig,
  loadConfig,
  redactConfig,
  redactRemoteUrl,
  resetConfigCache,
} from '../src/config.js';
import { AppError } from '../src/errors.js';

// The content dir defaults under the home directory, so every case needs one.
const HOME = '/home/alice';

describe('loadConfig defaults', () => {
  const config = loadConfig({ HOME });

  it('applies every documented default', () => {
    expect(config.contentDir).toBe(`${HOME}/${DEFAULT_CONTENT_SUBDIR}`);
    expect(config.port).toBe(4000);
    expect(config.gitBranch).toBe('main');
    expect(config.gitAuthorName).toBe('tablinum');
    expect(config.gitAuthorEmail).toBe('tablinum@localhost');
    expect(config.gitRemote).toBeNull();
    expect(config.autocommitMs).toBe(15000);
    expect(config.commitMaxHoldMs).toBe(120000);
    expect(config.autopullMs).toBe(60000);
    expect(config.autopushMs).toBe(5000);
  });

  it('starts with no API token at all', () => {
    expect(config.apiTokens).toEqual([]);
  });

  it('generates a session secret and freezes the result', () => {
    expect(config.sessionSecret).toHaveLength(64);
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('loadConfig overrides', () => {
  const config = loadConfig({
    HOME,
    TABLINUM_CONTENT_DIR: '/srv/docs/',
    TABLINUM_PORT: '8080',
    TABLINUM_API_TOKENS: ' alpha, beta ,, alpha ',
    TABLINUM_SESSION_SECRET: 'a-long-enough-secret',
    TABLINUM_GIT_REMOTE: 'git@example.com:team/docs.git',
    TABLINUM_GIT_BRANCH: 'trunk',
    TABLINUM_AUTOCOMMIT_MS: '0',
    TABLINUM_COMMIT_MAX_HOLD_MS: '0',
    TABLINUM_AUTOPULL_MS: '0',
    TABLINUM_AUTOPUSH_MS: '0',
  });

  it('trims the content dir and parses the port', () => {
    expect(config.contentDir).toBe('/srv/docs');
    expect(config.port).toBe(8080);
  });

  it('splits, trims and dedupes tokens', () => {
    expect(config.apiTokens).toEqual(['alpha', 'beta']);
  });

  it('accepts zero for the timers', () => {
    expect(config.autocommitMs).toBe(0);
    expect(config.commitMaxHoldMs).toBe(0);
    expect(config.autopullMs).toBe(0);
    expect(config.autopushMs).toBe(0);
  });

  it('reads every spelling of a boolean, and stays off by default', () => {
    expect(loadConfig({ HOME }).trustProxy).toBe(false);
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(loadConfig({ HOME, TABLINUM_TRUST_PROXY: value }).trustProxy).toBe(true);
    }
    for (const value of ['0', 'false', 'no', 'off']) {
      expect(loadConfig({ HOME, TABLINUM_TRUST_PROXY: value }).trustProxy).toBe(false);
    }
  });

  it('treats an empty variable as unset', () => {
    expect(loadConfig({ HOME, TABLINUM_GIT_BRANCH: '   ' }).gitBranch).toBe('main');
    expect(loadConfig({ HOME, TABLINUM_API_TOKENS: '  ' }).apiTokens).toEqual([]);
  });
});

describe('loadConfig validation', () => {
  const bad: Array<[string, Record<string, string>]> = [
    ['non-numeric port', { HOME, TABLINUM_PORT: 'nope' }],
    ['port 0', { HOME, TABLINUM_PORT: '0' }],
    ['port above range', { HOME, TABLINUM_PORT: '70000' }],
    ['fractional port', { HOME, TABLINUM_PORT: '80.5' }],
    ['relative content dir', { HOME, TABLINUM_CONTENT_DIR: 'relative/dir' }],
    ['traversing content dir', { HOME, TABLINUM_CONTENT_DIR: '../content' }],
    ['branch with whitespace', { HOME, TABLINUM_GIT_BRANCH: 'my branch' }],
    ['author email without @', { HOME, TABLINUM_GIT_AUTHOR_EMAIL: 'tablinum' }],
    ['short session secret', { HOME, TABLINUM_SESSION_SECRET: 'short' }],
    ['negative autocommit', { HOME, TABLINUM_AUTOCOMMIT_MS: '-1' }],
    ['unreadable boolean', { HOME, TABLINUM_TRUST_PROXY: 'maybe' }],
    ['short webhook secret', { HOME, TABLINUM_WEBHOOK_SECRET: 'too-short' }],
  ];

  it.each(bad)('throws on %s', (_label, env) => {
    expect(() => loadConfig(env)).toThrow(AppError);
  });

  it('refuses to guess a content dir when there is no home directory', () => {
    expect(() => loadConfig({})).toThrow(/TABLINUM_CONTENT_DIR is unset/);
  });

  it('falls back to the windows home variable', () => {
    expect(loadConfig({ USERPROFILE: 'C:\\Users\\alice' }).contentDir).toBe(
      `C:\\Users\\alice/${DEFAULT_CONTENT_SUBDIR}`,
    );
  });

  it('reports the offending variable', () => {
    expect(() => loadConfig({ HOME, TABLINUM_PORT: 'nope' })).toThrow(/TABLINUM_PORT/);
  });
});

describe('TABLINUM_WEBHOOK_SECRET', () => {
  it('is unset by default, which turns agent webhooks off', () => {
    expect(loadConfig({ HOME }).webhookSecret).toBeNull();
  });

  it('is kept when it is long enough, and never printed', () => {
    const config = loadConfig({ HOME, TABLINUM_WEBHOOK_SECRET: 'a-signing-secret-long-enough' });
    expect(config.webhookSecret).toBe('a-signing-secret-long-enough');
    expect(redactConfig(config).webhookSecret).toBe('set');
    expect(JSON.stringify(redactConfig(config))).not.toContain('a-signing-secret');
  });
});

describe('getConfig', () => {
  it('memoizes until reset', () => {
    resetConfigCache();
    const first = getConfig({ HOME, TABLINUM_PORT: '5001' });
    expect(getConfig({ HOME, TABLINUM_PORT: '5002' })).toBe(first);
    resetConfigCache();
    expect(getConfig({ HOME, TABLINUM_PORT: '5002' }).port).toBe(5002);
    resetConfigCache();
  });
});

describe('redactConfig', () => {
  it('hides secrets', () => {
    const redacted = redactConfig(
      loadConfig({ HOME, TABLINUM_API_TOKENS: 'a,b', TABLINUM_SESSION_SECRET: 'hunter2-and-then-some' }),
    );
    expect(redacted.apiTokens).toBe('2 token(s)');
    expect(redacted.sessionSecret).toBe('set');
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
  });

  it('washes the token out of the git remote', () => {
    const redacted = redactConfig(
      loadConfig({
        HOME,
        TABLINUM_GIT_REMOTE: 'https://x-access-token:ghp_secret@github.com/acme/docs.git',
      }),
    );
    expect(JSON.stringify(redacted)).not.toContain('ghp_secret');
    expect(redacted.gitRemote).toContain('github.com/acme/docs.git');
  });

  it('leaves an ssh remote as it is', () => {
    const redacted = redactConfig(
      loadConfig({ HOME, TABLINUM_GIT_REMOTE: 'git@github.com:acme/docs.git' }),
    );
    expect(redacted.gitRemote).toBe('git@github.com:acme/docs.git');
  });
});

describe('redactRemoteUrl', () => {
  it('drops the user name and the password of an https remote', () => {
    expect(redactRemoteUrl('https://x-access-token:ghp_secret@github.com/acme/docs.git')).toBe(
      'https://github.com/acme/docs.git',
    );
    // GitHub also accepts the token as the user name alone, so the name goes too.
    expect(redactRemoteUrl('https://ghp_secret@github.com/acme/docs.git')).toBe(
      'https://github.com/acme/docs.git',
    );
  });

  it('returns anything without credentials unchanged', () => {
    expect(redactRemoteUrl('https://github.com/acme/docs.git')).toBe(
      'https://github.com/acme/docs.git',
    );
    expect(redactRemoteUrl('git@github.com:acme/docs.git')).toBe('git@github.com:acme/docs.git');
    expect(redactRemoteUrl('/srv/tablinum/remote.git')).toBe('/srv/tablinum/remote.git');
    expect(redactRemoteUrl('')).toBe('');
    expect(redactRemoteUrl(null)).toBeNull();
  });
});
