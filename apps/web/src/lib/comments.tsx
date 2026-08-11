import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  unresolvedCount,
  type CommentAnchor,
  type CommentThread,
  type Database,
  type PageId,
} from '@tablinum/shared';
import { useCommentThreads, useDatabase } from '../api/hooks';

/** What a thread being written is about. Both fields null means the whole page. */
export interface CommentDraft {
  anchor: CommentAnchor | null;
  /** The id of a database column. */
  column: string | null;
}

/**
 * The comment panel's shared state. The editor and the panel both need to know which thread
 * is in focus, and only the editor can say which anchors still find their text, so that answer
 * travels back through here.
 */
export interface CommentsValue {
  pageId: PageId | null;
  threads: CommentThread[];
  /** Threads still waiting for an answer. The number on the comments button. */
  unresolved: number;
  loading: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  activeId: string | null;
  /** Show the panel and put one thread in focus. Null only clears the focus. */
  focus: (threadId: string | null) => void;
  /** The thread being written, or null while nothing is being written. */
  draft: CommentDraft | null;
  startDraft: (draft: CommentDraft) => void;
  cancelDraft: () => void;
  showResolved: boolean;
  setShowResolved: (show: boolean) => void;
  /**
   * Threads whose quoted text was found in the document as it stands now. Null until the
   * editor has answered, so nothing is called orphaned before anybody has looked.
   */
  located: ReadonlySet<string> | null;
  reportLocated: (ids: string[]) => void;
  /** The schema the page's database has now, which names its columns. Null when it is not one. */
  schema: Database | null;
}

const IDLE: CommentsValue = {
  pageId: null,
  threads: [],
  unresolved: 0,
  loading: false,
  open: false,
  setOpen: () => undefined,
  activeId: null,
  focus: () => undefined,
  draft: null,
  startDraft: () => undefined,
  cancelDraft: () => undefined,
  showResolved: false,
  setShowResolved: () => undefined,
  located: null,
  reportLocated: () => undefined,
  schema: null,
};

const CommentsContext = createContext<CommentsValue>(IDLE);

/** Comments are optional: without a provider the editor simply draws no highlights. */
export function useComments(): CommentsValue {
  return useContext(CommentsContext);
}

export function CommentsProvider({ pageId, children }: { pageId: PageId; children: ReactNode }) {
  const query = useCommentThreads(pageId);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [located, setLocated] = useState<ReadonlySet<string> | null>(null);

  const threads = useMemo(() => query.data?.threads ?? [], [query.data]);

  // Only the schema names a column, and it comes from the cache the grid already fills, so a
  // rename shows here at once. Read only while a column is in play: a page that is not a database
  // has no schema to answer with, which is why null here reads as "no columns to name".
  const aboutColumn =
    (draft !== null && draft.column !== null) || threads.some((thread) => thread.column !== null);
  const schemaQuery = useDatabase(aboutColumn ? pageId : undefined);
  const schema = schemaQuery.data?.database ?? null;

  const focus = useCallback((threadId: string | null) => {
    setActiveId(threadId);
    if (threadId === null) return;
    setDraft(null);
    setOpen(true);
  }, []);

  const startDraft = useCallback((next: CommentDraft) => {
    setDraft(next);
    setActiveId(null);
    setOpen(true);
  }, []);

  const cancelDraft = useCallback(() => setDraft(null), []);

  // Written on every recompute, so the identical set must not become a new render.
  const reportLocated = useCallback((ids: string[]) => {
    setLocated((previous) => {
      if (previous !== null && ids.length === previous.size && ids.every((id) => previous.has(id))) {
        return previous;
      }
      return new Set(ids);
    });
  }, []);

  const value = useMemo<CommentsValue>(
    () => ({
      pageId,
      threads,
      unresolved: unresolvedCount(threads),
      loading: query.isLoading,
      open,
      setOpen,
      activeId,
      focus,
      draft,
      startDraft,
      cancelDraft,
      showResolved,
      setShowResolved,
      located,
      reportLocated,
      schema,
    }),
    [
      pageId,
      threads,
      query.isLoading,
      open,
      activeId,
      focus,
      draft,
      startDraft,
      cancelDraft,
      showResolved,
      located,
      reportLocated,
      schema,
    ],
  );

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}
