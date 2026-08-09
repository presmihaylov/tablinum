import { useEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useResolvedTheme } from '../../lib/theme';
import { MERMAID_DEBOUNCE_MS, mermaidErrorMessage, renderMermaid } from '../mermaid';
import { LanguagePicker, readLanguage } from './LanguagePicker';

const COPIED_MS = 1500;

/**
 * A `mermaid` fence, drawn. The diagram is what a reader sees; the source opens under
 * the toolbar as soon as the caret enters the block, so the two are on screen together
 * while a diagram is being written.
 */
export function MermaidView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const source = node.textContent;
  const settled = useDebouncedValue(source, MERMAID_DEBOUNCE_MS);
  const theme = useResolvedTheme();

  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const inside = useCaretInside(editor, getPos, node.nodeSize);
  const open = editor.isEditable && inside && !collapsed;

  // The caret left, so the next visit opens the source again.
  useEffect(() => {
    if (!inside) setCollapsed(false);
  }, [inside]);

  useEffect(() => {
    if (settled.trim().length === 0) {
      setSvg('');
      setError(null);
      return;
    }
    let live = true;
    renderMermaid(settled, theme).then(
      (drawn) => {
        if (!live) return;
        setSvg(drawn);
        setError(null);
      },
      (failure: unknown) => {
        // The last good picture stays up: half-typed mermaid is invalid mermaid, and a
        // box that blinks on every keystroke is worse than a stale diagram plus a line.
        if (live) setError(mermaidErrorMessage(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [settled, theme]);

  const showSource = (): void => {
    if (!editor.isEditable) return;
    const pos = getPos();
    setCollapsed(false);
    if (typeof pos !== 'number') return;
    editor.chain().focus().setTextSelection(pos + 1).run();
  };

  // The caret cannot always step out of the last block of a document, so the source is
  // hidden and the editor is blurred instead of moving the selection.
  const showDiagram = (): void => {
    setCollapsed(true);
    editor.commands.blur();
  };

  const copy = (): void => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(source).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_MS);
    }, noop);
  };

  return (
    <NodeViewWrapper className="gd-editor-mermaid" data-source={open ? 'open' : 'closed'}>
      <div className="gd-editor-mermaid__bar" contentEditable={false}>
        <LanguagePicker
          className="gd-editor-mermaid__lang"
          language={readLanguage(node)}
          disabled={!editor.isEditable}
          onPick={(language) => updateAttributes({ language, info: null })}
        />
        {editor.isEditable ? (
          <button
            type="button"
            className="gd-editor-mermaid__button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={open ? showDiagram : showSource}
          >
            {open ? 'Diagram' : 'Source'}
          </button>
        ) : null}
        <button
          type="button"
          className="gd-editor-mermaid__button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre className="gd-editor-mermaid__source" hidden={!open}>
        <NodeViewContent as="code" />
      </pre>

      <div
        className="gd-editor-mermaid__preview"
        contentEditable={false}
        onClick={showSource}
        aria-label="Mermaid diagram"
      >
        {svg.length > 0 ? (
          // mermaid ran with `securityLevel: 'strict'`, which puts its own output through
          // DOMPurify before handing it back. Nothing else here is ever set as HTML.
          <div
            className={`gd-editor-mermaid__figure${error === null ? '' : ' is-stale'}`}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p className="gd-editor-mermaid__note">{emptyNote(source, error)}</p>
        )}
      </div>

      {error === null ? null : (
        <p className="gd-editor-mermaid__error" contentEditable={false}>
          {error}
        </p>
      )}
    </NodeViewWrapper>
  );
}

function emptyNote(source: string, error: string | null): string {
  if (source.trim().length === 0) return 'Write mermaid source to draw a diagram.';
  return error === null ? 'Drawing the diagram…' : 'Nothing has been drawn yet.';
}

function noop(): void {
  return undefined;
}

/**
 * True while the editor holds the caret inside this node. A blurred editor still has a
 * selection, so focus counts too: a page that opens on a diagram shows the picture.
 */
function useCaretInside(editor: Editor, getPos: () => number, nodeSize: number): boolean {
  const [inside, setInside] = useState(false);
  const sizeRef = useRef(nodeSize);
  sizeRef.current = nodeSize;

  useEffect(() => {
    const update = (): void => {
      const pos = getPos();
      if (typeof pos !== 'number' || !editor.isFocused) {
        setInside(false);
        return;
      }
      const { from, to } = editor.state.selection;
      setInside(to > pos && from < pos + sizeRef.current);
    };
    update();
    const events = ['transaction', 'focus', 'blur'] as const;
    for (const event of events) editor.on(event, update);
    return () => {
      for (const event of events) editor.off(event, update);
    };
  }, [editor, getPos]);

  return inside;
}

export default MermaidView;
