import {
  IconSchema,
  PagePathSchema,
  assertValidPagePath,
  notFound,
  parseOrThrow,
  validation,
  type CreatePageBody,
  type UpdatePageBody,
} from '@tablinum/shared';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { TablinumClient } from './client.js';
import {
  formatComments,
  formatGitStatus,
  formatHistory,
  formatPage,
  formatPageLine,
  formatSearchHits,
  formatTreeOutline,
} from './format.js';
import { resolvePage, resolvePageId } from './refs.js';

/** A tool as this package models it: schema, prose for the model, and a text-returning handler. */
export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputShape: z.ZodRawShape;
  annotations: ToolAnnotations;
  /** Validate `rawArgs`, run the tool, and return the text the model should see. */
  run(client: TablinumClient, rawArgs: unknown): Promise<string>;
}

interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputShape: Shape;
  annotations: ToolAnnotations;
  run(client: TablinumClient, args: z.infer<z.ZodObject<Shape>>): Promise<string>;
}

function defineTool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): ToolSpec {
  const schema = z.object(definition.inputShape);
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputShape: definition.inputShape,
    annotations: definition.annotations,
    run: (client, rawArgs) =>
      definition.run(client, parseOrThrow(schema, rawArgs ?? {}, `${definition.name} arguments`)),
  };
}

// ---------------------------------------------------------------------------
// shared argument shapes
// ---------------------------------------------------------------------------

const idArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Stable page id, e.g. "pg_01J8XYZABCDEFGHJKMNPQRSTVW". Survives renames and moves. Give this OR "path".',
  );

const pathArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Page path, e.g. "eng/runbooks/deploy". Lowercase, slash separated, no leading or trailing slash, no ".md". Give this OR "id".',
  );

const pageRefShape = { id: idArg, path: pathArg };

const iconArg = IconSchema.optional().describe(
  'The icon shown next to the page title: a single emoji, or ":shortcode:" naming a custom emoji ' +
    'somebody uploaded.',
);

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

const searchTool = defineTool({
  name: 'tablinum_search',
  title: 'Search pages',
  description: [
    'Full text search over every tablinum page. This is the fastest way to find the path or id of a page.',
    'Run it BEFORE tablinum_create_page so you do not create a duplicate of a page that already exists.',
    'Returns ranked hits: title, path, id, score and a one line snippet. It does not return page bodies,',
    'so follow a promising hit with tablinum_get_page. Narrow the result with "space", the first path',
    'segment, such as "eng". If nothing matches, use fewer words or call tablinum_list_tree.',
  ].join(' '),
  annotations: { readOnlyHint: true, openWorldHint: false, title: 'Search pages' },
  inputShape: {
    query: z.string().min(1).describe('Words to look for. Plain words work best; this is not a regex.'),
    space: z
      .string()
      .min(1)
      .optional()
      .describe('Restrict the search to one space slug, e.g. "eng".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Maximum number of hits, 1 to 200. The server default is used when omitted.'),
  },
  run: async (client, args) => {
    const hits = await client.search({ q: args.query, space: args.space, limit: args.limit });
    return formatSearchHits(hits, args.query);
  },
});

const getPageTool = defineTool({
  name: 'tablinum_get_page',
  title: 'Read a page',
  description: [
    'Read one page in full. Give either "path" or "id"; giving neither is an error.',
    'The result is a metadata header (path, id, title, icon, order, timestamps) followed by',
    'the markdown body, verbatim and unchanged. Always read a page with this tool before you rewrite it,',
    'so you know the exact current body.',
  ].join(' '),
  annotations: { readOnlyHint: true, openWorldHint: false, title: 'Read a page' },
  inputShape: pageRefShape,
  run: async (client, args) => formatPage(await resolvePage(client, args)),
});

const listTreeTool = defineTool({
  name: 'tablinum_list_tree',
  title: 'List the page tree',
  description: [
    'List the whole page hierarchy as an indented outline, one line per page, with the page path in',
    'brackets. Use it to learn which spaces exist, where a topic belongs, and what the real paths are',
    'before you create, move or link a page. Pass "space" to show a single space. The outline carries no',
    'page bodies: read a page with tablinum_get_page.',
  ].join(' '),
  annotations: { readOnlyHint: true, openWorldHint: false, title: 'List the page tree' },
  inputShape: {
    space: z
      .string()
      .min(1)
      .optional()
      .describe('Show only this space slug, e.g. "eng". Omit to show every space.'),
  },
  run: async (client, args) => {
    const spaces = await client.tree();
    if (args.space === undefined) return formatTreeOutline(spaces);
    const one = spaces.find((space) => space.slug === args.space);
    if (one === undefined) {
      const available = spaces.map((space) => space.slug).join(', ');
      throw notFound(
        `No space named ${JSON.stringify(args.space)}. Available spaces: ${available.length === 0 ? '(none yet)' : available}.`,
      );
    }
    return formatTreeOutline([one]);
  },
});

const createPageTool = defineTool({
  name: 'tablinum_create_page',
  title: 'Create a page',
  description: [
    'Create a new page. "path" decides where it lives: the first segment is the space, the remaining',
    'segments are the parent chain, e.g. "eng/runbooks/deploy" creates "deploy" under "eng/runbooks".',
    'Parent pages are promoted automatically, so you do not have to create them by hand.',
    'Fails with CONFLICT when a page already exists at that path; search first.',
    'Do NOT write YAML frontmatter into "markdown": the server owns id, created and updated, and it writes',
    'title, icon and order from these arguments. Do not repeat the title as a level 1 heading',
    'in the body either; start the body with a short summary paragraph.',
  ].join(' '),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, title: 'Create a page' },
  inputShape: {
    path: PagePathSchema.describe(
      'Where to create the page, e.g. "eng/runbooks/deploy". Lowercase kebab-case segments, no leading or trailing slash, no ".md", no "index" as the last segment.',
    ),
    title: z.string().min(1).describe('Human readable title. Sentence case reads best.'),
    markdown: z
      .string()
      .describe(
        'The page body in CommonMark + GFM. No frontmatter. Headings start at "##". Link to another page with [[page-path]] or [[page-path|alias]]. Pass "" for an empty page.',
      ),
    icon: iconArg,
    order: z
      .number()
      .optional()
      .describe('Sort key among siblings. Lower sorts first. Omit to sort by title.'),
  },
  run: async (client, args) => {
    const body: CreatePageBody = { path: args.path, title: args.title, markdown: args.markdown };
    if (args.icon !== undefined) body.icon = args.icon;
    if (args.order !== undefined) body.order = args.order;
    const page = await client.createPage(body);
    return `Created page.\n${formatPageLine(page)}`;
  },
});

const updatePageTool = defineTool({
  name: 'tablinum_update_page',
  title: 'Update a page',
  description: [
    'Update an existing page. Identify it with "id" or "path".',
    'EVERY CONTENT FIELD IS OPTIONAL AND ONLY THE FIELDS YOU SEND ARE CHANGED.',
    'If you omit "markdown" the body is left exactly as it is and only the metadata changes, so this is the',
    'safe way to set a title, an icon or an order without touching the text.',
    'Send "markdown" only when you hold the COMPLETE new body; it replaces the whole body. To add text to',
    'the end of a page use tablinum_append_page instead, and to move a page use tablinum_move_page.',
    'Pass icon: null or order: null to clear that field.',
  ].join(' '),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, title: 'Update a page' },
  inputShape: {
    ...pageRefShape,
    title: z.string().min(1).optional().describe('New title. Omit to keep the current title.'),
    markdown: z
      .string()
      .optional()
      .describe(
        'Complete replacement body, without frontmatter. OMIT THIS FIELD to leave the body untouched.',
      ),
    icon: IconSchema.nullable()
      .optional()
      .describe(
        'New icon: a single emoji or ":shortcode:" for a custom one. Pass null to remove the ' +
          'icon. Omit to keep it.',
      ),
    order: z
      .number()
      .nullable()
      .optional()
      .describe('New sibling sort key, or null to clear it. Omit to keep it.'),
  },
  run: async (client, args) => {
    const patch: UpdatePageBody = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.markdown !== undefined) patch.markdown = args.markdown;
    if (args.icon !== undefined) patch.icon = args.icon;
    if (args.order !== undefined) patch.order = args.order;
    if (Object.keys(patch).length === 0) {
      throw validation(
        'Nothing to update. Send at least one of "title", "markdown", "icon" or "order".',
      );
    }
    const id = await resolvePageId(client, args);
    const page = await client.updatePage(id, patch);
    const changed = Object.keys(patch).join(', ');
    return `Updated ${changed}.\n${formatPageLine(page)}`;
  },
});

const appendPageTool = defineTool({
  name: 'tablinum_append_page',
  title: 'Append to a page',
  description: [
    'Add markdown to the END of a page without resending the text you are not changing.',
    'The current body is read, a blank line is inserted, and your markdown is written after it.',
    'Use this for a new section, a log entry, a decision record or a note, and prefer it over',
    'tablinum_update_page whenever you are only adding content: it cannot blank the page by accident.',
    'Identify the page with "id" or "path".',
  ].join(' '),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, title: 'Append to a page' },
  inputShape: {
    ...pageRefShape,
    markdown: z
      .string()
      .min(1)
      .describe(
        'Markdown to add at the end of the page. No frontmatter. Start a new section with a "##" heading.',
      ),
  },
  run: async (client, args) => {
    const addition = args.markdown.replace(/^\n+/, '').trimEnd();
    if (addition.length === 0) {
      throw validation('"markdown" is empty after trimming, so there is nothing to append.');
    }
    const page = await resolvePage(client, args);
    const base = page.markdown.trimEnd();
    const next = base.length === 0 ? `${addition}\n` : `${base}\n\n${addition}\n`;
    const updated = await client.updatePage(page.id, { markdown: next });
    return [
      `Appended ${addition.length} characters to ${updated.path}. The body is now ${next.length} characters.`,
      formatPageLine(updated),
    ].join('\n');
  },
});

const movePageTool = defineTool({
  name: 'tablinum_move_page',
  title: 'Move or rename a page',
  description: [
    'Move a page to a new path, which also renames it. Identify the page with "id" or "path".',
    'The page id, its body and its git history are unchanged; only the location changes, and every child',
    'page moves with it. Moving into a different first segment moves the page to another space.',
    'Fails with CONFLICT when a page already sits at "newPath".',
  ].join(' '),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, title: 'Move or rename a page' },
  inputShape: {
    ...pageRefShape,
    newPath: PagePathSchema.describe(
      'The new full path, e.g. "eng/runbooks/deploy-v2". Give the whole path, not just the new name.',
    ),
  },
  run: async (client, args) => {
    const newPath = assertValidPagePath(args.newPath, 'newPath');
    const id = await resolvePageId(client, args);
    const page = await client.updatePage(id, { path: newPath });
    return `Moved page to ${page.path}.\n${formatPageLine(page)}`;
  },
});

const deletePageTool = defineTool({
  name: 'tablinum_delete_page',
  title: 'Delete a page',
  description: [
    'Delete a page. Identify it with "id" or "path".',
    'A page that has children is refused unless you pass recursive: true, which deletes the whole subtree.',
    'Returns the list of deleted paths. The deletion is written to the content git repository, so an',
    'operator can still restore it from history, but this tool cannot undo it. Prefer tablinum_move_page',
    'to an archive path when you are not certain.',
  ].join(' '),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, title: 'Delete a page' },
  inputShape: {
    ...pageRefShape,
    recursive: z
      .boolean()
      .optional()
      .describe('Set true to delete the page together with every page below it. Default false.'),
  },
  run: async (client, args) => {
    const id = await resolvePageId(client, args);
    const deleted = await client.deletePage(id, args.recursive ?? false);
    if (deleted.length === 0) return 'Nothing was deleted.';
    const list = deleted.map((path) => `- ${path}`).join('\n');
    return `Deleted ${deleted.length} page${deleted.length === 1 ? '' : 's'}:\n${list}`;
  },
});

const pageHistoryTool = defineTool({
  name: 'tablinum_page_history',
  title: 'Page history',
  description: [
    'List the git commits that touched one page, newest first. Identify the page with "id" or "path".',
    'Each line is: short sha, ISO date, author, subject. Use it to see who changed a page and when,',
    'or to find the sha of an older version. The server commits edits after a short delay, so a page',
    'created seconds ago can still have an empty history.',
  ].join(' '),
  annotations: { readOnlyHint: true, openWorldHint: false, title: 'Page history' },
  inputShape: {
    ...pageRefShape,
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Maximum number of commits, 1 to 500.'),
  },
  run: async (client, args) => {
    const page = await resolvePage(client, args);
    const revisions = await client.history(page.id, args.limit);
    return formatHistory(revisions, page);
  },
});

const listCommentsTool = defineTool({
  name: 'tablinum_list_comments',
  title: 'Read the comments on a page',
  description: [
    'List the comment threads people left on one page. Identify the page with "id" or "path".',
    'Comments are review feedback and they are NOT part of the page: they live beside the file and',
    'never appear in the markdown. Read them before you rewrite a page, so you answer what people',
    'actually asked for. Each thread shows the text it is about, whether it is open or resolved, and',
    'every remark with its author and date. A thread marked as no longer in the page was written',
    'about text somebody has since changed; find the new wording before you act on it.',
    'This tool only reads. Reply to a thread in the web UI, not here.',
  ].join(' '),
  annotations: { readOnlyHint: true, openWorldHint: false, title: 'Read the comments on a page' },
  inputShape: {
    ...pageRefShape,
    open: z
      .boolean()
      .optional()
      .describe('Set true for the unanswered threads only. Omit for open and resolved together.'),
  },
  run: async (client, args) => {
    const page = await resolvePage(client, args);
    const threads = await client.comments(page.id, args.open === true ? false : undefined);
    if (threads.length === 0) return formatComments(threads, page, (id) => id);

    const people = new Map((await client.listUsers()).map((user) => [user.id, user.name]));
    return formatComments(threads, page, (id) => people.get(id) ?? 'a former member');
  },
});

const gitSyncTool = defineTool({
  name: 'tablinum_git_sync',
  title: 'Sync with the git remote',
  description: [
    'Synchronise the content repository with its git remote.',
    'The tool commits any pending edit first, then pulls, then pushes when push is true.',
    'Call it after a batch of edits so that other people and other agents see your work, and call it',
    'before a batch of edits so that you work on the newest content. Returns the branch, the remote,',
    'the ahead and behind counts and the last commit. With no remote configured the pull and push are',
    'local no-ops and only the commit takes effect.',
  ].join(' '),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: 'Sync with the git remote' },
  inputShape: {
    push: z
      .boolean()
      .optional()
      .describe('Set true to push after the pull. Default false, which pulls only.'),
  },
  run: async (client, args) => {
    const lines: string[] = [];
    const sha = await client.gitCommit();
    lines.push(
      sha === null ? 'No pending edit to commit.' : `Committed pending edits as ${sha.slice(0, 8)}.`,
    );

    const pull = await client.gitPull();
    lines.push(`Pulled ${pull.pulled} commit${pull.pulled === 1 ? '' : 's'} from the remote.`);
    let status = pull.status;

    if (args.push === true) {
      const push = await client.gitPush();
      status = push.status;
      lines.push(push.pushed ? 'Pushed to the remote.' : 'Nothing to push; the remote is up to date.');
    }
    if (args.push !== true) {
      lines.push('Skipped the push. Call again with push: true to publish the local commits.');
    }

    lines.push('', formatGitStatus(status));
    return lines.join('\n');
  },
});

/** Every tool this MCP server exposes, in the order a model should discover them. */
export const TOOL_SPECS: readonly ToolSpec[] = [
  searchTool,
  getPageTool,
  listTreeTool,
  createPageTool,
  updatePageTool,
  appendPageTool,
  movePageTool,
  deletePageTool,
  listCommentsTool,
  pageHistoryTool,
  gitSyncTool,
];

/** Look one tool up by name. Used by tests and by any embedder that drives tools directly. */
export function getToolSpec(name: string): ToolSpec {
  const spec = TOOL_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined) {
    throw notFound(
      `No tool named ${JSON.stringify(name)}. Available: ${TOOL_SPECS.map((t) => t.name).join(', ')}.`,
    );
  }
  return spec;
}
