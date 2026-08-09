import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { DiagramOptions } from '../extensions/diagram';

/**
 * Read mode is a plain picture: the stored SVG, nothing else. The drawing canvas is a
 * separate chunk that only loads when someone asks to edit.
 */
export function DiagramView({ node, extension, editor, updateAttributes }: NodeViewProps) {
  const src = typeof node.attrs['src'] === 'string' ? node.attrs['src'] : '';
  const label = typeof node.attrs['label'] === 'string' ? node.attrs['label'] : '';
  const rev = typeof node.attrs['rev'] === 'number' ? node.attrs['rev'] : 0;
  const options = extension.options as DiagramOptions;

  // The file keeps its name across saves, so the revision is what busts the browser cache.
  const url = rev === 0 ? src : `${src}?v=${rev}`;

  const edit = (): void => {
    if (!editor.isEditable) return;
    options.edit({
      src,
      onSave: (saved) => updateAttributes({ src: saved, rev: rev + 1 }),
    });
  };

  return (
    <NodeViewWrapper as="div" className="gd-editor-diagram" data-src={src}>
      <div className="gd-editor-diagram__frame" onDoubleClick={edit}>
        <img className="gd-editor-diagram__image" src={url} alt={label} draggable={false} />
        {editor.isEditable ? (
          <button
            type="button"
            className="gd-editor-diagram__edit"
            title="Edit this diagram"
            onMouseDown={(event) => event.preventDefault()}
            onClick={edit}
          >
            Edit
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

export default DiagramView;
