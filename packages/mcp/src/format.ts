import type {
  CommentThread,
  GitStatus,
  Page,
  Revision,
  SearchHit,
  TreeNode,
} from '@tablinum/shared';
import type { SpaceTree } from './client.js';

const SNIPPET_MAX = 240;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  const flat = collapse(value);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function withIcon(icon: string | undefined, text: string): string {
  if (icon === undefined || icon.length === 0) return text;
  return `${icon} ${text}`;
}

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------

function outlineNodes(nodes: TreeNode[], indent: string, out: string[]): void {
  for (const node of nodes) {
    out.push(`${indent}- ${withIcon(node.icon, node.title)}  [${node.path}]`);
    if (node.children.length > 0) outlineNodes(node.children, `${indent}  `, out);
  }
}

/** Indented outline of the page tree: one line per page, path in brackets. */
export function formatTreeOutline(spaces: SpaceTree[]): string {
  if (spaces.length === 0) {
    return 'No spaces exist yet. Create the first page with tablinum_create_page; its first path segment becomes the space.';
  }
  const lines: string[] = [];
  for (const space of spaces) {
    lines.push(`${withIcon(space.icon, space.name)}  (space "${space.slug}")`);
    if (space.tree.length === 0) lines.push('  (no pages yet)');
    outlineNodes(space.tree, '  ', lines);
    lines.push('');
  }
  const total = spaces.reduce((sum, space) => sum + countNodes(space.tree), 0);
  lines.push(`${count(total, 'page')} in ${count(spaces.length, 'space')}.`);
  return lines.join('\n').trim();
}

function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/** Ranked hits, one block per hit, snippet flattened to a single line. */
export function formatSearchHits(hits: SearchHit[], query: string): string {
  if (hits.length === 0) {
    return `No page matches ${JSON.stringify(query)}. Try fewer or broader words, drop the space filter, or call tablinum_list_tree to browse.`;
  }
  const lines = [`${count(hits.length, 'hit')} for ${JSON.stringify(query)}:`, ''];
  hits.forEach((hit, index) => {
    lines.push(`${index + 1}. ${hit.title}  [${hit.path}]  id=${hit.id}  score=${hit.score.toFixed(2)}`);
    const snippet = clip(hit.snippet, SNIPPET_MAX);
    if (snippet.length > 0) lines.push(`   ${snippet}`);
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

/** Metadata header plus the page body, verbatim and unmodified. */
export function formatPage(page: Page): string {
  const header = [
    '--- tablinum page ---',
    `path: ${page.path}`,
    `id: ${page.id}`,
    `space: ${page.space}`,
    `title: ${page.title}`,
  ];
  if (page.icon !== undefined) header.push(`icon: ${page.icon}`);
  if (page.order !== undefined) header.push(`order: ${page.order}`);
  header.push(`created: ${page.created}`);
  header.push(`updated: ${page.updated}`);
  header.push(`hasChildren: ${page.hasChildren}`);
  header.push('--- markdown ---');
  return `${header.join('\n')}\n${page.markdown}`;
}

/** One-line summary used after a write, so the model can confirm the result. */
export function formatPageLine(page: Page): string {
  const bits = [`path=${page.path}`, `id=${page.id}`, `title=${JSON.stringify(page.title)}`];
  if (page.icon !== undefined) bits.push(`icon=${page.icon}`);
  if (page.order !== undefined) bits.push(`order=${page.order}`);
  bits.push(`updated=${page.updated}`);
  return bits.join('  ');
}

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

const QUOTE_MAX = 120;

/**
 * Comment threads on one page, newest business first: the quoted text a thread is about, then
 * every remark in order. A thread whose quote is no longer in the page is called out, because
 * acting on it means finding the new home of that sentence first.
 */
export function formatComments(
  threads: CommentThread[],
  page: Pick<Page, 'path' | 'id' | 'markdown'>,
  nameOf: (userId: string) => string,
): string {
  if (threads.length === 0) {
    return `Nobody has commented on ${page.path} yet.`;
  }

  const lines = [`${count(threads.length, 'comment thread')} on ${page.path} (${page.id}):`, ''];
  for (const thread of threads) {
    const state = thread.resolved ? 'resolved' : 'open';
    lines.push(`[${state}] thread ${thread.id}`);
    if (thread.anchor === null) lines.push('  about: the whole page');
    if (thread.anchor !== null) {
      const found = page.markdown.includes(thread.anchor.quote);
      const note = found ? '' : '  (this text is no longer in the page)';
      lines.push(`  about: ${JSON.stringify(clip(thread.anchor.quote, QUOTE_MAX))}${note}`);
    }
    for (const comment of thread.comments) {
      const edited = comment.updated === comment.created ? '' : ' (edited)';
      lines.push(`  ${nameOf(comment.author)}  ${comment.created}${edited}`);
      for (const line of comment.body.split('\n')) lines.push(`    ${line}`);
    }
    lines.push('');
  }
  lines.push('Comments are not part of the page. Editing the page does not answer them.');
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

/** Compact commit log: short sha, date, author, subject line. */
export function formatHistory(revisions: Revision[], page: Pick<Page, 'path' | 'id'>): string {
  if (revisions.length === 0) {
    return `No commit touches ${page.path} yet. The server commits edits on a short delay, so a brand new page can have an empty history.`;
  }
  const lines = [`${count(revisions.length, 'revision')} of ${page.path} (${page.id}):`, ''];
  for (const revision of revisions) {
    const subject = collapse(revision.message.split('\n')[0] ?? '');
    lines.push(`${revision.sha.slice(0, 8)}  ${revision.date}  ${revision.author}  ${subject}`);
  }
  lines.push('');
  lines.push('Read one revision with the REST endpoint GET /api/v1/pages/<id>/revisions/<sha>.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

/** Working tree and remote state, one fact per line. */
export function formatGitStatus(status: GitStatus): string {
  const dirty =
    status.dirtyFiles.length === 0
      ? 'none'
      : `${count(status.dirtyFiles.length, 'file')} (${status.dirtyFiles.slice(0, 10).join(', ')}${status.dirtyFiles.length > 10 ? ', ...' : ''})`;
  const lines = [
    `branch: ${status.branch}`,
    `remote: ${status.remote ?? 'none configured'}`,
    `ahead: ${status.ahead}, behind: ${status.behind}`,
    `dirty files: ${dirty}`,
  ];
  if (status.lastCommit !== null) {
    const commit = status.lastCommit;
    lines.push(
      `last commit: ${commit.sha.slice(0, 8)} ${commit.date} ${commit.author} ${collapse(commit.message.split('\n')[0] ?? '')}`,
    );
  }
  return lines.join('\n');
}
