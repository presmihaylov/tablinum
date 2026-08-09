import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL, USAGE, parseCliOptions } from '../src/cli-options.js';

describe('parseCliOptions', () => {
  it('falls back to the local server and no token', () => {
    expect(parseCliOptions([], {})).toEqual({
      baseUrl: DEFAULT_BASE_URL,
      token: null,
      mode: 'serve',
    });
  });

  it('reads the environment', () => {
    const options = parseCliOptions([], {
      TABLINUM_URL: 'https://docs.example.com',
      TABLINUM_TOKEN: 'tok_1',
    });
    expect(options).toEqual({ baseUrl: 'https://docs.example.com', token: 'tok_1', mode: 'serve' });
  });

  it('lets a flag win over the environment', () => {
    const options = parseCliOptions(['--url', 'http://localhost:5000', '--token', 'flag_token'], {
      TABLINUM_URL: 'https://docs.example.com',
      TABLINUM_TOKEN: 'env_token',
    });
    expect(options.baseUrl).toBe('http://localhost:5000');
    expect(options.token).toBe('flag_token');
  });

  it('accepts the --flag=value form', () => {
    const options = parseCliOptions(['--url=http://localhost:5000', '--token=abc'], {});
    expect(options.baseUrl).toBe('http://localhost:5000');
    expect(options.token).toBe('abc');
  });

  it('treats a blank environment value as unset', () => {
    const options = parseCliOptions([], { TABLINUM_URL: '   ', TABLINUM_TOKEN: '' });
    expect(options.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(options.token).toBeNull();
  });

  it('switches to help and version modes', () => {
    expect(parseCliOptions(['--help'], {}).mode).toBe('help');
    expect(parseCliOptions(['-h'], {}).mode).toBe('help');
    expect(parseCliOptions(['--version'], {}).mode).toBe('version');
    expect(parseCliOptions(['-v'], {}).mode).toBe('version');
  });

  it('documents both environment variables in the usage text', () => {
    expect(USAGE).toContain('TABLINUM_URL');
    expect(USAGE).toContain('TABLINUM_TOKEN');
  });
});
