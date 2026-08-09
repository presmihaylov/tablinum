import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT_DIR,
  getConfig,
  loadConfig,
  redactConfig,
  resetConfigCache,
} from '../src/config.js';
import { AppError } from '../src/errors.js';

describe('loadConfig defaults', () => {
  const config = loadConfig({});

  it('applies every documented default', () => {
    expect(config.contentDir).toBe(DEFAULT_CONTENT_DIR);
    expect(config.port).toBe(4000);
    expect(config.gitBranch).toBe('main');
    expect(config.gitAuthorName).toBe('gitdocs');
    expect(config.gitAuthorEmail).toBe('gitdocs@localhost');
    expect(config.gitRemote).toBeNull();
    expect(config.autocommitMs).toBe(5000);
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
    GITDOCS_CONTENT_DIR: '/srv/docs/',
    GITDOCS_PORT: '8080',
    GITDOCS_API_TOKENS: ' alpha, beta ,, alpha ',
    GITDOCS_SESSION_SECRET: 'a-long-enough-secret',
    GITDOCS_GIT_REMOTE: 'git@example.com:team/docs.git',
    GITDOCS_GIT_BRANCH: 'trunk',
    GITDOCS_AUTOCOMMIT_MS: '0',
    GITDOCS_AUTOPULL_MS: '0',
    GITDOCS_AUTOPUSH_MS: '0',
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
    expect(config.autopullMs).toBe(0);
    expect(config.autopushMs).toBe(0);
  });

  it('treats an empty variable as unset', () => {
    expect(loadConfig({ GITDOCS_GIT_BRANCH: '   ' }).gitBranch).toBe('main');
    expect(loadConfig({ GITDOCS_API_TOKENS: '  ' }).apiTokens).toEqual([]);
  });
});

describe('loadConfig validation', () => {
  const bad: Array<[string, Record<string, string>]> = [
    ['non-numeric port', { GITDOCS_PORT: 'nope' }],
    ['port 0', { GITDOCS_PORT: '0' }],
    ['port above range', { GITDOCS_PORT: '70000' }],
    ['fractional port', { GITDOCS_PORT: '80.5' }],
    ['relative content dir', { GITDOCS_CONTENT_DIR: 'relative/dir' }],
    ['traversing content dir', { GITDOCS_CONTENT_DIR: '../content' }],
    ['branch with whitespace', { GITDOCS_GIT_BRANCH: 'my branch' }],
    ['author email without @', { GITDOCS_GIT_AUTHOR_EMAIL: 'gitdocs' }],
    ['short session secret', { GITDOCS_SESSION_SECRET: 'short' }],
    ['negative autocommit', { GITDOCS_AUTOCOMMIT_MS: '-1' }],
  ];

  it.each(bad)('throws on %s', (_label, env) => {
    expect(() => loadConfig(env)).toThrow(AppError);
  });

  it('reports the offending variable', () => {
    expect(() => loadConfig({ GITDOCS_PORT: 'nope' })).toThrow(/GITDOCS_PORT/);
  });
});

describe('getConfig', () => {
  it('memoizes until reset', () => {
    resetConfigCache();
    const first = getConfig({ GITDOCS_PORT: '5001' });
    expect(getConfig({ GITDOCS_PORT: '5002' })).toBe(first);
    resetConfigCache();
    expect(getConfig({ GITDOCS_PORT: '5002' }).port).toBe(5002);
    resetConfigCache();
  });
});

describe('redactConfig', () => {
  it('hides secrets', () => {
    const redacted = redactConfig(
      loadConfig({ GITDOCS_API_TOKENS: 'a,b', GITDOCS_SESSION_SECRET: 'hunter2-and-then-some' }),
    );
    expect(redacted.apiTokens).toBe('2 token(s)');
    expect(redacted.sessionSecret).toBe('set');
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
  });
});
