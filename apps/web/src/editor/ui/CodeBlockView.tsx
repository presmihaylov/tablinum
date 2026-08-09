import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { MERMAID_LANGUAGE } from '../mermaid';
import { LanguagePicker, readLanguage } from './LanguagePicker';
import { MermaidView } from './MermaidView';

/** A fence. `mermaid` is drawn as a diagram; every other language is code. */
export function CodeBlockView(props: NodeViewProps) {
  if (readLanguage(props.node) === MERMAID_LANGUAGE) return <MermaidView {...props} />;
  return <PlainCodeBlockView {...props} />;
}

/** A code block with a language picker in its top-right corner. */
function PlainCodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper className="gd-editor-codeblock">
      <LanguagePicker
        className="gd-editor-codeblock__lang"
        language={readLanguage(node)}
        disabled={!editor.isEditable}
        // `info` holds the raw fence info string; clearing it lets the new
        // language decide what gets written back to markdown.
        onPick={(language) => updateAttributes({ language, info: null })}
      />
      <pre className="gd-editor-codeblock__pre">
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export default CodeBlockView;
