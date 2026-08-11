/** House conventions for writing pages in this tablinum instance, addressed to a model. */
export const STYLE_GUIDE = `# How to write pages in tablinum

Every page here is one markdown file with YAML frontmatter, stored in a git repository. Humans edit
the same pages in a block editor in the browser. Write so that both stay readable.

## Frontmatter: the server owns it
- Never write a \`---\` frontmatter block inside the \`markdown\` argument. The server writes it.
- \`id\`, \`created\` and \`updated\` are managed for you and must not be set by hand.
- Set \`title\`, \`icon\` and \`order\` through the tool arguments instead.

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
- Use the real page path, for example \`[[eng/runbooks/deploy]]\`. Confirm it with tablinum_search or
  tablinum_list_tree first; a link to a path that does not exist renders as a broken link.
- Use ordinary markdown links for anything outside this docs site.
- Reference an uploaded file as \`/_assets/<pageId>/<filename>\`.

## Paths, titles and spaces
- A path looks like \`eng/runbooks/deploy\`: lowercase, kebab-case segments, slash separated, no
  leading or trailing slash, no \`.md\`, and never \`index\` as the last segment.
- The first segment is the space. Write into a space that exists: an agent token may not start
  one, so a path naming a space nobody has made yet is refused.
- Group by topic, not by author or by date. Keep the tree no deeper than four levels.

## Working safely next to humans
- Search before you create. A near duplicate page is worse than a longer existing page.
- Open a page with tablinum_open_page before you change anything in it. It prints the numbered
  blocks the other editing tools address, and it shows your caret to everyone reading the page.
- Edit the way a person does: tablinum_place_cursor to move, tablinum_select to take hold of text,
  then tablinum_type or tablinum_erase. tablinum_type replaces whatever is selected.
- To add a section, put the caret at the end with tablinum_place_cursor where: "end" and type it.
  Never select the whole page just to add to the end of it.
- To change only metadata, call tablinum_update_page. It never touches the body.
- Rename with tablinum_move_page, never by deleting and recreating: that would lose the page id,
  its history and every incoming link.
- Read tablinum_list_comments before you rewrite a page, so you answer what people asked for.
  Reply with tablinum_reply once you have done it, and only then tablinum_resolve_comment.
- Leave your own remark with tablinum_comment when a person has to decide something. Quote the
  words as a reader sees them, not as the markdown writes them. Do not comment to say you edited
  a page: the history already says that.
- Call tablinum_git_sync after a batch of edits so other people and other agents see them.`;

/** The same guide, scoped to one space when the caller names one. */
export function styleGuideFor(space: string | undefined): string {
  if (space === undefined || space.trim().length === 0) return STYLE_GUIDE;
  const slug = space.trim();
  return `${STYLE_GUIDE}

## For the "${slug}" space
- Every page you write now belongs under \`${slug}/...\`.
- Call tablinum_list_tree with space "${slug}" first, and match the naming the pages already there
  use.`;
}
