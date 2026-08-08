import { useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';
import { CellSelection, TableMap, addColumn, addRow, cellAround } from '@tiptap/pm/tables';
import type { TableRect } from '@tiptap/pm/tables';
import { startNodeDrag } from './nodeDrag';

export interface TableControlsProps {
  editor: Editor;
  /** The positioned box the controls are placed inside. */
  canvas: RefObject<HTMLDivElement>;
}

/** One row or one column, measured against the table box. */
interface Strip {
  start: number;
  size: number;
}

interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
  cols: Strip[];
  rows: Strip[];
}

/** How far the pointer may stray from the table before the controls go away. */
const KEEP_NEAR = 32;

/**
 * The row and column controls a table grows on hover: a grip per row and per column
 * that selects it whole, a corner grip that selects or drags the table, and the two
 * plus buttons that append a column on the right and a row at the bottom.
 *
 * They live outside the editable DOM, so every position is measured from the rendered
 * table and every edit goes back through ProseMirror.
 */
export function TableControls({ editor, canvas }: TableControlsProps) {
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const hovered = useRef<HTMLTableElement | null>(null);
  hovered.current = table;

  useEffect(() => {
    const box = canvas.current;
    if (!box) return;
    const track = (event: MouseEvent): void => {
      const under = tableUnder(editor, event.target);
      if (under) {
        setTable(under);
        return;
      }
      // The grips and the plus buttons sit outside the table, so the pointer has to
      // leave the whole neighbourhood before the controls may go away.
      const current = hovered.current;
      if (current && near(current, event)) return;
      setTable(null);
    };
    const clear = (): void => setTable(null);
    box.addEventListener('mousemove', track);
    box.addEventListener('mouseleave', clear);
    return () => {
      box.removeEventListener('mousemove', track);
      box.removeEventListener('mouseleave', clear);
    };
  }, [editor, canvas]);

  useEffect(() => {
    const box = canvas.current;
    if (!table || !box) {
      setGeometry(null);
      return;
    }
    const update = (): void => setGeometry(measure(table, box));
    update();
    editor.on('transaction', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      editor.off('transaction', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [table, editor, canvas]);

  if (!table || !geometry || !editor.isEditable) return null;

  const columns = geometry.cols.length;
  const cellAt = (row: number, column: number): ResolvedPos | null =>
    resolveCell(editor, table.rows[row]?.cells[column] ?? null);

  const apply = (selection: Selection | null): void => {
    if (!selection) return;
    const { view } = editor;
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
  };

  const selectColumn = (index: number): void => {
    const $cell = cellAt(0, index);
    apply($cell ? CellSelection.colSelection($cell) : null);
  };

  const selectRow = (index: number): void => {
    const $cell = cellAt(index, 0);
    apply($cell ? CellSelection.rowSelection($cell) : null);
  };

  const selectTable = (): void => {
    const $first = cellAt(0, 0);
    const $last = cellAt(0, columns - 1);
    apply($first && $last ? CellSelection.colSelection($first, $last) : null);
  };

  const dragTable = (event: ReactDragEvent<HTMLButtonElement>): void => {
    const $cell = cellAt(0, 0);
    if (!$cell || !event.dataTransfer) return;
    startNodeDrag(editor, $cell.before(-1), table, event.dataTransfer);
  };

  const appendColumn = (): void => {
    const rect = rectOf(cellAt(0, columns - 1));
    if (!rect) return;
    editor.view.dispatch(addColumn(editor.state.tr, rect, rect.map.width));
    editor.view.focus();
  };

  const appendRow = (): void => {
    const rect = rectOf(cellAt(0, 0));
    if (!rect) return;
    editor.view.dispatch(addRow(editor.state.tr, rect, rect.map.height));
    editor.view.focus();
  };

  return (
    <div
      className="gd-table-ctl"
      style={{
        left: `${geometry.left}px`,
        top: `${geometry.top}px`,
        width: `${geometry.width}px`,
        height: `${geometry.height}px`,
      }}
    >
      <button
        type="button"
        draggable
        className="gd-table-ctl__grip gd-table-ctl__grip--corner"
        title="Drag to move the table, click to select it"
        aria-label="Select the table"
        onMouseDown={(event) => event.preventDefault()}
        onClick={selectTable}
        onDragStart={dragTable}
      />

      {geometry.cols.map((col, index) => (
        <button
          key={`col-${index}`}
          type="button"
          className="gd-table-ctl__grip gd-table-ctl__grip--col"
          style={{ left: `${col.start}px`, width: `${col.size}px` }}
          title="Select the column"
          aria-label={`Select column ${index + 1}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectColumn(index)}
        />
      ))}

      {geometry.rows.map((row, index) => (
        <button
          key={`row-${index}`}
          type="button"
          className="gd-table-ctl__grip gd-table-ctl__grip--row"
          style={{ top: `${row.start}px`, height: `${row.size}px` }}
          title="Select the row"
          aria-label={`Select row ${index + 1}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectRow(index)}
        />
      ))}

      <button
        type="button"
        className="gd-table-ctl__add gd-table-ctl__add--col"
        title="Add a column"
        aria-label="Add a column"
        onMouseDown={(event) => event.preventDefault()}
        onClick={appendColumn}
      >
        <span aria-hidden="true">+</span>
      </button>

      <button
        type="button"
        className="gd-table-ctl__add gd-table-ctl__add--row"
        title="Add a row"
        aria-label="Add a row"
        onMouseDown={(event) => event.preventDefault()}
        onClick={appendRow}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

function tableUnder(editor: Editor, node: EventTarget | null): HTMLTableElement | null {
  if (!(node instanceof HTMLElement)) return null;
  const found = node.closest('table');
  if (!(found instanceof HTMLTableElement)) return null;
  return editor.view.dom.contains(found) ? found : null;
}

function near(table: HTMLTableElement, event: MouseEvent): boolean {
  const rect = table.getBoundingClientRect();
  return (
    event.clientX >= rect.left - KEEP_NEAR &&
    event.clientX <= rect.right + KEEP_NEAR &&
    event.clientY >= rect.top - KEEP_NEAR &&
    event.clientY <= rect.bottom + KEEP_NEAR
  );
}

/**
 * Column widths come off the first row: a GFM table has no spans, so its cells map
 * one to one onto the columns.
 */
function measure(table: HTMLTableElement, box: HTMLElement): Geometry | null {
  if (!box.contains(table)) return null;
  const rows = Array.from(table.rows);
  const head = rows[0];
  if (!head) return null;

  const base = box.getBoundingClientRect();
  const rect = table.getBoundingClientRect();
  return {
    left: rect.left - base.left,
    top: rect.top - base.top,
    width: rect.width,
    height: rect.height,
    cols: Array.from(head.cells).map((cell) => {
      const cellRect = cell.getBoundingClientRect();
      return { start: cellRect.left - rect.left, size: cellRect.width };
    }),
    rows: rows.map((row) => {
      const rowRect = row.getBoundingClientRect();
      return { start: rowRect.top - rect.top, size: rowRect.height };
    }),
  };
}

/** The document position just before the cell a rendered `<td>` or `<th>` stands for. */
function resolveCell(editor: Editor, element: HTMLTableCellElement | null): ResolvedPos | null {
  if (!element) return null;
  try {
    return cellAround(editor.state.doc.resolve(editor.view.posAtDOM(element, 0)));
  } catch {
    return null;
  }
}

/** The whole table as prosemirror-tables describes it, addressed from any one cell. */
function rectOf($cell: ResolvedPos | null): TableRect | null {
  if (!$cell) return null;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  return {
    map,
    table,
    tableStart: $cell.start(-1),
    left: 0,
    top: 0,
    right: map.width,
    bottom: map.height,
  };
}

export default TableControls;
