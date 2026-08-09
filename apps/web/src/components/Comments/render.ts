import MarkdownIt from 'markdown-it';

/**
 * Comment bodies as HTML.
 *
 * This is a second, plain markdown-it instance on purpose. The editor's own instance is tuned
 * for a byte-identical round trip and keeps raw HTML alive; a comment must never do that. Here
 * `html: false` makes markdown-it escape every tag it is given, and its link check refuses
 * `javascript:`, `vbscript:` and `data:` destinations, so nothing in a body can run.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

md.renderer.rules['link_open'] = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  // A comment can only point outward, and it must not hand the opened tab this one.
  if (token !== undefined) {
    token.attrSet('rel', 'noopener noreferrer nofollow');
    token.attrSet('target', '_blank');
  }
  return self.renderToken(tokens, index, options);
};

export function renderCommentBody(body: string): string {
  return md.render(body);
}
