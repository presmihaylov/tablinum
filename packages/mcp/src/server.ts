import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { TablinumClient } from './client.js';
import { formatTreeOutline } from './format.js';
import { styleGuideFor } from './style-guide.js';
import { toolErrorMessage } from './tool-errors.js';
import { TOOL_SPECS, type ToolSpec } from './tools.js';

export const MCP_SERVER_NAME = 'tablinum';
export const MCP_SERVER_VERSION = '0.1.0';
export const TREE_RESOURCE_URI = 'tablinum://tree';
export const STYLE_GUIDE_PROMPT = 'tablinum_style_guide';

const INSTRUCTIONS = [
  'tablinum is a self-hosted documentation site. Every page is a markdown file with YAML frontmatter',
  'inside a git repository, and people edit the same pages in a browser editor.',
  'Start with tablinum_search or tablinum_list_tree to find the real path of a page; every other tool',
  'accepts either that path or the stable page id.',
  'You edit a page the way a person does, never by replacing it in one call. Open it with',
  'tablinum_open_page, which prints it as numbered blocks and puts your caret on it. Then move the caret',
  'with tablinum_place_cursor, take hold of text with tablinum_select, and change it with tablinum_type or',
  'tablinum_erase. tablinum_type replaces whatever is selected, so select then type is how you rewrite a',
  'sentence, a block or a whole page. tablinum_update_page changes the title, the icon and the order only.',
  'Everyone reading the page sees your caret while you work, so open a page before you change it.',
  'Read the tablinum_style_guide prompt before you write your first page.',
].join(' ');

export interface CreateServerOptions {
  client: TablinumClient;
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
  client: TablinumClient,
  args: unknown,
): Promise<CallToolResult> {
  try {
    const text = await spec.run(client, args);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { content: [{ type: 'text', text: toolErrorMessage(err) }], isError: true };
  }
}

/** Render the whole page tree, the payload behind the `tablinum://tree` resource. */
export async function treeOutline(client: TablinumClient): Promise<string> {
  return formatTreeOutline(await client.tree());
}

/** The handshake instructions, with the caller's own identity in front when there is one. */
export function instructionsFor(identity?: string): string {
  const brief = identity?.trim() ?? '';
  return brief.length === 0 ? INSTRUCTIONS : `${brief}\n\n${INSTRUCTIONS}`;
}

/** Build a fully wired MCP server: every tool, the tree resource and the style guide prompt. */
export function createTablinumMcpServer(options: CreateServerOptions): McpServer {
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
    'tablinum-tree',
    TREE_RESOURCE_URI,
    {
      title: 'tablinum page tree',
      description:
        'The full page hierarchy of this tablinum site as an indented outline, one line per page with its path. Read it to learn which spaces and pages exist before you search or write.',
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
      title: 'tablinum style guide',
      description:
        'The house conventions for writing pages in this tablinum site: frontmatter rules, heading and link style, path naming, and how to edit safely next to human authors. Load it before you create or rewrite a page.',
      argsSchema: {
        space: z
          .string()
          .optional()
          .describe('Space slug you are about to write in, e.g. "eng". Adds guidance for that space.'),
      },
    },
    (args): GetPromptResult => ({
      description: 'tablinum writing conventions',
      messages: [
        { role: 'user', content: { type: 'text', text: styleGuideFor(args.space) } },
      ],
    }),
  );

  return server;
}
