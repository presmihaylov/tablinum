import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DiagramView } from '../ui/DiagramView';
import { DATA, decodeRaw, encodeRaw } from '../markdown';

/** What the shell needs in order to open one drawing. */
export interface DiagramRequest {
  /** The scene to reopen, or null for a blank canvas. */
  src: string | null;
  /** Called with the stored URL once the drawing has been written back. */
  onSave: (src: string) => void;
}

export interface DiagramOptions {
  /** Opens the drawing canvas. The shell owns it, because it owns the upload. */
  edit: (request: DiagramRequest) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diagram: {
      insertDiagram: (src: string, label?: string) => ReturnType;
    };
  }
}

/**
 * `![label](/_assets/<pageId>/<name>.excalidraw.svg)` alone on a line. The attachment is an
 * SVG with the drawing's scene embedded in it, so the page stays a plain markdown image that
 * GitHub renders, and the editor can still reopen the drawing.
 */
export const Diagram = Node.create<DiagramOptions>({
  name: 'diagram',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,

  addOptions() {
    return { edit: () => undefined };
  },

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute(DATA.diagram) ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          [DATA.diagram]: typeof attributes['src'] === 'string' ? attributes['src'] : '',
        }),
      },
      // The raw `![label]` source, as for an image: the label may hold markup and escapes.
      label: {
        default: '',
        parseHTML: (element: HTMLElement) => decodeRaw(element.getAttribute(DATA.label) ?? ''),
        renderHTML: (attributes: Record<string, unknown>) => ({
          [DATA.label]: encodeRaw(typeof attributes['label'] === 'string' ? attributes['label'] : ''),
        }),
      },
      /**
       * Bumped on every save. The file keeps its name, so nothing in the markdown changes and
       * only this tells the browser, and every other open tab, to fetch the picture again.
       */
      rev: { default: 0, rendered: false, keepOnSplit: false },
    };
  },

  parseHTML() {
    return [{ tag: `div[${DATA.diagram}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'gd-editor-diagram gd-editor-diagram--flat' }),
      markdownFor(node.attrs),
    ];
  },

  renderText({ node }) {
    return markdownFor(node.attrs);
  },

  addCommands() {
    return {
      insertDiagram:
        (src, label = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src, label } }),
    };
  },
});

function markdownFor(attrs: Record<string, unknown>): string {
  const src = typeof attrs['src'] === 'string' ? attrs['src'] : '';
  const label = typeof attrs['label'] === 'string' ? attrs['label'] : '';
  return `![${label}](${src})`;
}

const WithCanvas = Diagram.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView);
  },
});

export function createDiagram(interactive: boolean, options: DiagramOptions) {
  return (interactive ? WithCanvas : Diagram).configure(options);
}

export default Diagram;
