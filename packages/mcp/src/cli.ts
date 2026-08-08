#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { USAGE, parseCliOptions } from './cli-options.js';
import { GitdocsClient } from './client.js';
import { MCP_SERVER_VERSION, createGitdocsMcpServer } from './server.js';

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2), process.env);

  if (options.mode === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (options.mode === 'version') {
    process.stdout.write(`${MCP_SERVER_VERSION}\n`);
    return;
  }

  const client = new GitdocsClient({ baseUrl: options.baseUrl, token: options.token });
  const server = createGitdocsMcpServer({ client });
  await server.connect(new StdioServerTransport());

  // stdout carries MCP frames, so every log line goes to stderr.
  const auth = options.token === null ? 'no token' : 'bearer token';
  process.stderr.write(`gitdocs MCP server ready: ${options.baseUrl} (${auth})\n`);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`gitdocs MCP server failed to start: ${message}\n`);
  process.exit(1);
});
