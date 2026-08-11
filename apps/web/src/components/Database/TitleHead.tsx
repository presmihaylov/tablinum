import {
  TITLE_COLUMN_ID,
  renameTitleColumn,
  titleColumnName,
  withView,
  type Database,
  type DbView,
} from '@tablinum/shared';
import { ColumnHead } from './ColumnHead';

interface TitleHeadProps {
  database: Database;
  view: DbView;
  /** The page the database is on. A database embedded in another page carries the host's id. */
  pageId: string;
  onDatabaseChange: (next: Database) => void;
}

/**
 * The header of the title column. It offers nothing else: a title is always text, and hiding or
 * deleting the column would leave every row with nothing to answer to.
 */
export function TitleHead({ database, view, pageId, onDatabaseChange }: TitleHeadProps) {
  return (
    <ColumnHead
      name={titleColumnName(database)}
      kind="Title"
      columnId={TITLE_COLUMN_ID}
      pageId={pageId}
      onRename={(name) => onDatabaseChange(renameTitleColumn(database, name))}
      onSort={(direction) =>
        onDatabaseChange(withView(database, view.id, { sorts: [{ property: TITLE_COLUMN_ID, direction }] }))
      }
    />
  );
}
