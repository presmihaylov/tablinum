import MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { HANDLE_PATTERN } from '@tablinum/shared';

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

const AT = 0x40;
const MENTION_RE = new RegExp(`^@(${HANDLE_PATTERN})`, 'i');

/** Only at the start of a word, so `mail@example.com` is an address and not a mention. */
const MENTION_OPENER_RE = /[\s([{<"'*_~]/;

/** The same plain `@handle` the pages carry, so one body reads the same everywhere. */
function mentionRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== AT) return false;

  const before = state.pos === 0 ? '' : state.src.charAt(state.pos - 1);
  if (before !== '' && !MENTION_OPENER_RE.test(before)) return false;

  const match = MENTION_RE.exec(state.src.slice(state.pos, state.posMax));
  if (match === null) return false;

  if (!silent) {
    const token = state.push('comment_mention', 'span', 0);
    token.markup = '@';
    token.content = match[1] ?? '';
  }

  state.pos += match[0].length;
  return true;
}

md.inline.ruler.before('link', 'comment_mention', mentionRule);

md.renderer.rules['comment_mention'] = (tokens, index, _options, env: unknown) => {
  const handle = tokens[index]?.content ?? '';
  const me = readMe(env);
  const mine = me !== null && me === handle.toLowerCase();
  const classes = mine ? 'comment__mention comment__mention--me' : 'comment__mention';
  return `<span class="${classes}">@${md.utils.escapeHtml(handle)}</span>`;
};

function readMe(env: unknown): string | null {
  if (typeof env !== 'object' || env === null) return null;
  const me = (env as { me?: unknown }).me;
  return typeof me === 'string' ? me.toLowerCase() : null;
}

/** `me` is the reader's handle, so a mention of them stands out from the rest. */
export function renderCommentBody(body: string, me?: string | null): string {
  return md.render(body, { me: me ?? null });
}
