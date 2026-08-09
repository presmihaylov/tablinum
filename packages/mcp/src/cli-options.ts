export const DEFAULT_BASE_URL = 'http://127.0.0.1:4000';

export interface CliOptions {
  baseUrl: string;
  token: string | null;
  /** `help` and `version` print and exit instead of serving. */
  mode: 'serve' | 'help' | 'version';
}

export const USAGE = `tablinum-mcp - MCP stdio server for a tablinum site

Usage:
  tablinum-mcp [--url <base-url>] [--token <token>]

Options:
  --url <base-url>   Base URL of the running tablinum server. Default ${DEFAULT_BASE_URL}
  --token <token>    Bearer token, one of the server's TABLINUM_API_TOKENS. Optional in open mode.
  -h, --help         Print this help.
  -v, --version      Print the version.

Environment:
  TABLINUM_URL        Same as --url.
  TABLINUM_TOKEN      Same as --token.

The server speaks MCP over stdio, so stdout carries protocol frames only. Logs go to stderr.`;

export type EnvSource = Record<string, string | undefined>;

function readFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  return undefined;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Resolve CLI flags over environment variables over defaults. */
export function parseCliOptions(argv: string[], env: EnvSource): CliOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { baseUrl: DEFAULT_BASE_URL, token: null, mode: 'help' };
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    return { baseUrl: DEFAULT_BASE_URL, token: null, mode: 'version' };
  }
  const baseUrl = clean(readFlag(argv, 'url')) ?? clean(env['TABLINUM_URL']) ?? DEFAULT_BASE_URL;
  const token = clean(readFlag(argv, 'token')) ?? clean(env['TABLINUM_TOKEN']) ?? null;
  return { baseUrl, token, mode: 'serve' };
}
