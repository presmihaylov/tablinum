import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** The id the draft span carries while a new thread is being written. */
export const DRAFT_SPAN_ID = 'draft';

/** One highlighted range: a thread that found its text, or the selection being commented on. */
export interface CommentSpan {
  id: string;
  from: number;
  to: number;
  resolved: boolean;
}

interface HighlightState {
  decorations: DecorationSet;
}

interface HighlightAction {
  spans: CommentSpan[];
  activeId: string | null;
}

export interface CommentHighlightOptions {
  /** Called on every click in the document: the thread under it, or null for none. */
  onActivate: (threadId: string | null) => void;
}

export const commentHighlightKey = new PluginKey<HighlightState>('gdCommentHighlight');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentHighlight: {
      /** Draw these ranges, with one of them marked as the thread in focus. */
      setCommentSpans: (spans: CommentSpan[], activeId: string | null) => ReturnType;
    };
  }
}

function classFor(span: CommentSpan, activeId: string | null): string {
  const classes = ['gd-comment'];
  if (span.id === DRAFT_SPAN_ID) classes.push('gd-comment--draft');
  if (span.resolved) classes.push('gd-comment--resolved');
  if (span.id === activeId) classes.push('gd-comment--active');
  return classes.join(' ');
}

function decorationsFor(spans: CommentSpan[], activeId: string | null, size: number): Decoration[] {
  return spans
    .filter((span) => span.from >= 0 && span.to > span.from && span.to <= size)
    .map((span) =>
      Decoration.inline(
        span.from,
        span.to,
        // The panel reads this attribute to put the thread card beside the words it marks.
        { class: classFor(span, activeId), 'data-comment-anchor': span.id },
        { threadId: span.id },
      ),
    );
}

function threadAt(decorations: DecorationSet, pos: number): string | null {
  for (const found of decorations.find(pos, pos)) {
    const id: unknown = found.spec['threadId'];
    if (typeof id === 'string' && id !== DRAFT_SPAN_ID) return id;
  }
  return null;
}

/**
 * Comment highlights, drawn as decorations rather than as a mark. A decoration is never
 * serialized, so no thread id can reach the markdown file even by accident. Between two
 * recomputes the ranges are mapped through every edit, so a highlight follows the text it
 * sits on while somebody types.
 */
export const CommentHighlight = Extension.create<CommentHighlightOptions>({
  name: 'commentHighlight',

  addOptions() {
    return { onActivate: () => undefined };
  },

  addCommands() {
    return {
      setCommentSpans:
        (spans, activeId) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(commentHighlightKey, { spans, activeId }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { onActivate } = this.options;

    return [
      new Plugin<HighlightState>({
        key: commentHighlightKey,
        state: {
          init: (): HighlightState => ({ decorations: DecorationSet.empty }),
          apply(tr, value): HighlightState {
            const action: HighlightAction | undefined = tr.getMeta(commentHighlightKey);
            if (action !== undefined) {
              const spans = decorationsFor(action.spans, action.activeId, tr.doc.content.size);
              return { decorations: DecorationSet.create(tr.doc, spans) };
            }
            if (!tr.docChanged) return value;
            return { decorations: value.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations(state): DecorationSet | undefined {
            return commentHighlightKey.getState(state)?.decorations;
          },
          handleClick(view, pos): boolean {
            const decorations = commentHighlightKey.getState(view.state)?.decorations;
            if (decorations === undefined) return false;
            // Null too: a click away from every highlight takes the thread out of focus.
            onActivate(threadAt(decorations, pos));
            // The caret still moves: a click in the text is an edit gesture first.
            return false;
          },
        },
      }),
    ];
  },
});

export default CommentHighlight;
