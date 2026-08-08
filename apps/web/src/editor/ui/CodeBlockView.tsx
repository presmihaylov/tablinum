import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { CODE_LANGUAGES } from '../extensions/languages';

/** A code block with a language picker in its top-right corner. */
export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const language = typeof node.attrs['language'] === 'string' ? node.attrs['language'] : '';
  // A file may name a language lowlight does not know; keep it selectable.
  const languages =
    language === '' || CODE_LANGUAGES.includes(language)
      ? CODE_LANGUAGES
      : [language, ...CODE_LANGUAGES];

  return (
    <NodeViewWrapper className="gd-editor-codeblock">
      <select
        className="gd-editor-codeblock__lang"
        aria-label="Code language"
        value={language}
        disabled={!editor.isEditable}
        contentEditable={false}
        onChange={(event) => {
          const next = event.target.value;
          // `info` holds the raw fence info string; clearing it lets the new
          // language decide what gets written back to markdown.
          updateAttributes({ language: next.length > 0 ? next : null, info: null });
        }}
      >
        <option value="">plain text</option>
        {languages.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <pre className="gd-editor-codeblock__pre">
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export default CodeBlockView;
