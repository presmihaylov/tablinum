import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { FloatingBar } from './FloatingBar';

/** What the grips selected: whole rows, whole columns, everything, or a plain range. */
type Scope = 'row' | 'column' | 'table' | 'cells';

interface TableAction {
  id: string;
  label: string;
  scopes: readonly Scope[];
  run: (editor: Editor) => void;
}

const ACTIONS: readonly TableAction[] = [
  {
    id: 'rowBefore',
    label: 'Row above',
    scopes: ['row', 'cells'],
    run: (e) => e.chain().focus().addRowBefore().run(),
  },
  {
    id: 'rowAfter',
    label: 'Row below',
    scopes: ['row', 'cells'],
    run: (e) => e.chain().focus().addRowAfter().run(),
  },
  {
    id: 'colBefore',
    label: 'Column left',
    scopes: ['column', 'cells'],
    run: (e) => e.chain().focus().addColumnBefore().run(),
  },
  {
    id: 'colAfter',
    label: 'Column right',
    scopes: ['column', 'cells'],
    run: (e) => e.chain().focus().addColumnAfter().run(),
  },
  {
    id: 'delRow',
    label: 'Delete row',
    scopes: ['row', 'cells'],
    run: (e) => e.chain().focus().deleteRow().run(),
  },
  {
    id: 'delCol',
    label: 'Delete column',
    scopes: ['column', 'cells'],
    run: (e) => e.chain().focus().deleteColumn().run(),
  },
  {
    id: 'delTable',
    label: 'Delete table',
    scopes: ['table', 'cells'],
    run: (e) => e.chain().focus().deleteTable().run(),
  },
];

/**
 * Cells are selected, never a bare caret: typing inside a table must not put a
 * toolbar over the text. The grips are what open this.
 */
function scopeOf(editor: Editor): Scope | null {
  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) return null;
  const rows = selection.isRowSelection();
  const columns = selection.isColSelection();
  if (rows && columns) return 'table';
  if (rows) return 'row';
  if (columns) return 'column';
  return 'cells';
}

/** Must stay a stable reference: FloatingBar resubscribes whenever it changes. */
function hasCells(editor: Editor): boolean {
  return scopeOf(editor) !== null;
}

function useScope(editor: Editor): Scope | null {
  const [scope, setScope] = useState<Scope | null>(() => scopeOf(editor));
  useEffect(() => {
    const update = (): void => setScope(scopeOf(editor));
    update();
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);
  return scope;
}

/** Row and column actions for whatever the table grips selected. */
export function TableMenu({ editor }: { editor: Editor }) {
  const scope = useScope(editor);

  return (
    <FloatingBar editor={editor} shouldShow={hasCells} label="Table">
      {ACTIONS.filter((action) => scope !== null && action.scopes.includes(scope)).map((action) => (
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
