import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { GitdocsClient } from './client.js';
import { formatTreeOutline } from './format.js';
import { styleGuideFor } from './style-guide.js';
import { toolErrorMessage } from './tool-errors.js';
import { TOOL_SPECS, type ToolSpec } from './tools.js';

export const MCP_SERVER_NAME = 'gitdocs';
export const MCP_SERVER_VERSION = '0.1.0';
export const TREE_RESOURCE_URI = 'gitdocs://tree';
export const STYLE_GUIDE_PROMPT = 'gitdocs_style_guide';

const INSTRUCTIONS = [
  'gitdocs is a self-hosted documentation site. Every page is a markdown file with YAML frontmatter',
  'inside a git repository, and people edit the same pages in a browser editor.',
  'Start with gitdocs_search or gitdocs_list_tree to find the real path of a page; every other tool',
  'accepts either that path or the stable page id.',
  'Read a page with gitdocs_get_page before you rewrite it. Use gitdocs_append_page to add to the end',
  'of a page, and call gitdocs_update_page without "markdown" when you only change metadata.',
  'Read the gitdocs_style_guide prompt before you write your first page.',
].join(' ');

export interface CreateServerOptions {
  client: GitdocsClient;
  /** Server name reported in the MCP handshake. */
  name?: string;
  version?: string;
  /**
   * Who the connected caller is, as the site defines it. The remote server passes the brief of
   * the agent behind the token, so an agent reads its own role before it calls a single tool.
   */
  identity?: string;
}

async function runTool(
  spec: ToolSpec,
  client: GitdocsClient,
  args: unknown,
): Promise<CallToolResult> {
  try {
    const text = await spec.run(client, args);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { content: [{ type: 'text', text: toolErrorMessage(err) }], isError: true };
  }
}

/** Render the whole page tree, the payload behind the `gitdocs://tree` resource. */
export async function treeOutline(client: GitdocsClient): Promise<string> {
  return formatTreeOutline(await client.tree());
}

/** The handshake instructions, with the caller's own identity in front when there is one. */
export function instructionsFor(identity?: string): string {
  const brief = identity?.trim() ?? '';
  return brief.length === 0 ? INSTRUCTIONS : `${brief}\n\n${INSTRUCTIONS}`;
}

/** Build a fully wired MCP server: every tool, the tree resource and the style guide prompt. */
export function createGitdocsMcpServer(options: CreateServerOptions): McpServer {
  const client = options.client;
  const server = new McpServer(
    { name: options.name ?? MCP_SERVER_NAME, version: options.version ?? MCP_SERVER_VERSION },
    { instructions: instructionsFor(options.identity) },
  );

  for (const spec of TOOL_SPECS) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputShape,
        annotations: spec.annotations,
      },
      (args: unknown) => runTool(spec, client, args),
    );
  }

  server.registerResource(
    'gitdocs-tree',
    TREE_RESOURCE_URI,
    {
      title: 'gitdocs page tree',
      description:
        'The full page hierarchy of this gitdocs site as an indented outline, one line per page with its path. Read it to learn which spaces and pages exist before you search or write.',
      mimeType: 'text/markdown',
    },
    async (uri): Promise<ReadResourceResult> => {
      try {
        const text = await treeOutline(client);
        return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
      } catch (err) {
        throw new Error(toolErrorMessage(err));
      }
    },
  );

  server.registerPrompt(
    STYLE_GUIDE_PROMPT,
    {
      title: 'gitdocs style guide',
      description:
        'The house conventions for writing pages in this gitdocs site: frontmatter rules, heading and link style, path naming, and how to edit safely next to human authors. Load it before you create or rewrite a page.',
      argsSchema: {
        space: z
          .string()
          .optional()
          .describe('Space slug you are about to write in, e.g. "eng". Adds guidance for that space.'),
      },
    },
    (args): GetPromptResult => ({
      description: 'gitdocs writing conventions',
      messages: [
        { role: 'user', content: { type: 'text', text: styleGuideFor(args.space) } },
      ],
    }),
  );

  return server;
}
