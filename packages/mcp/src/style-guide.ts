/** House conventions for writing pages in this gitdocs instance, addressed to a model. */
export const STYLE_GUIDE = `# How to write pages in gitdocs

Every page here is one markdown file with YAML frontmatter, stored in a git repository. Humans edit
the same pages in a block editor in the browser. Write so that both stay readable.

## Frontmatter: the server owns it
- Never write a \`---\` frontmatter block inside the \`markdown\` argument. The server writes it.
- \`id\`, \`created\` and \`updated\` are managed for you and must not be set by hand.
- Set \`title\`, \`icon\`, \`tags\`, \`order\` and \`props\` through the tool arguments instead.

## Body
- Do not repeat the title as a level 1 heading. The title already renders above the body.
- Open with one short paragraph that says what the page is and who it is for.
- Start headings at \`##\` and go no deeper than \`####\`. Use sentence case: "Rollback procedure".
- Keep paragraphs to three or four sentences. Prefer a list or a table over a long paragraph.
- Use GitHub flavoured markdown: tables, task lists, strikethrough and autolinks all render.
- Fence every code block and give it a language, for example \`\`\`bash.
- Write instructions as numbered steps, one action per step, in the imperative.
- Put a warning or a caution immediately before the step it applies to.

## Links
- Link to another page with \`[[page-path]]\`, or \`[[page-path|the words you want to show]]\`.
- Use the real page path, for example \`[[eng/runbooks/deploy]]\`. Confirm it with gitdocs_search or
  gitdocs_list_tree first; a link to a path that does not exist renders as a broken link.
- Use ordinary markdown links for anything outside this docs site.
- Reference an uploaded file as \`/_assets/<pageId>/<filename>\`.

## Paths, titles and spaces
- A path looks like \`eng/runbooks/deploy\`: lowercase, kebab-case segments, slash separated, no
  leading or trailing slash, no \`.md\`, and never \`index\` as the last segment.
- The first segment is the space. Reuse an existing space rather than inventing a new one.
- Group by topic, not by author or by date. Keep the tree no deeper than four levels.

## Tags and props
- Tags are lowercase, single words or kebab-case, and describe the subject: \`ops\`, \`deploy\`,
  \`postmortem\`. Three tags is usually enough.
- Props hold structured fields that drive the table view: \`status\`, \`owner\`, \`due\`, \`reviewed\`.
- Prop keys are lowercase snake_case. Reuse the keys the sibling pages already use, so that
  gitdocs_query_view returns one clean table instead of a ragged one.
- Values stay short: a word, a number, a boolean, an ISO date, or a short list of words.

## Working safely next to humans
- Search before you create. A near duplicate page is worse than a longer existing page.
- Read a page with gitdocs_get_page before you rewrite it.
- To add a section, use gitdocs_append_page. Never resend a whole body just to add to the end.
- To change only metadata, call gitdocs_update_page WITHOUT \`markdown\`. Sending an empty
  \`markdown\` blanks the page.
- \`tags\` and \`props\` replace the whole list or map. Resend the entries you want to keep.
- Rename with gitdocs_move_page, never by deleting and recreating: that would lose the page id,
  its history and every incoming link.
- Call gitdocs_git_sync after a batch of edits so other people and other agents see them.`;

/** The same guide, scoped to one space when the caller names one. */
export function styleGuideFor(space: string | undefined): string {
  if (space === undefined || space.trim().length === 0) return STYLE_GUIDE;
  const slug = space.trim();
  return `${STYLE_GUIDE}

## For the "${slug}" space
- Every page you write now belongs under \`${slug}/...\`.
- Call gitdocs_list_tree with space "${slug}" first, and match the naming, the tags and the prop keys
  the pages already there use.`;
}
