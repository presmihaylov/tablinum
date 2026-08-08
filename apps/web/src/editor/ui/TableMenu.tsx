import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { FloatingBar } from './FloatingBar';

interface TableAction {
  id: string;
  label: string;
  run: (editor: Editor) => void;
}

const ACTIONS: readonly TableAction[] = [
  { id: 'rowBefore', label: 'Row above', run: (e) => e.chain().focus().addRowBefore().run() },
  { id: 'rowAfter', label: 'Row below', run: (e) => e.chain().focus().addRowAfter().run() },
  { id: 'colBefore', label: 'Column left', run: (e) => e.chain().focus().addColumnBefore().run() },
  { id: 'colAfter', label: 'Column right', run: (e) => e.chain().focus().addColumnAfter().run() },
  { id: 'delRow', label: 'Delete row', run: (e) => e.chain().focus().deleteRow().run() },
  { id: 'delCol', label: 'Delete column', run: (e) => e.chain().focus().deleteColumn().run() },
  { id: 'delTable', label: 'Delete table', run: (e) => e.chain().focus().deleteTable().run() },
];

function inTable(editor: Editor): boolean {
  if (!editor.isActive('table')) return false;
  const { from, to } = editor.state.selection;
  return from === to || editor.state.selection instanceof CellSelection;
}

/** Row and column controls, shown while the caret sits inside a table. */
export function TableMenu({ editor }: { editor: Editor }) {
  return (
    <FloatingBar editor={editor} shouldShow={inTable} label="Table">
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          className="gd-editor-bar__btn gd-editor-bar__btn--wide"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => action.run(editor)}
        >
          {action.label}
        </button>
      ))}
    </FloatingBar>
  );
}

export default TableMenu;
