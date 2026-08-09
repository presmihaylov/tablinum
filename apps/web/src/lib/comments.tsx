import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { unresolvedCount, type CommentAnchor, type CommentThread, type PageId } from '@tablinum/shared';
import { useCommentThreads } from '../api/hooks';

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
  /** The selection a new thread is being written about, or null for the whole page. */
  draft: CommentAnchor | null;
  drafting: boolean;
  startDraft: (anchor: CommentAnchor | null) => void;
  cancelDraft: () => void;
  showResolved: boolean;
  setShowResolved: (show: boolean) => void;
  /**
   * Threads whose quoted text was found in the document as it stands now. Null until the
   * editor has answered, so nothing is called orphaned before anybody has looked.
   */
  located: ReadonlySet<string> | null;
  reportLocated: (ids: string[]) => void;
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
  drafting: false,
  startDraft: () => undefined,
  cancelDraft: () => undefined,
  showResolved: false,
  setShowResolved: () => undefined,
  located: null,
  reportLocated: () => undefined,
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
  const [draft, setDraft] = useState<CommentAnchor | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [located, setLocated] = useState<ReadonlySet<string> | null>(null);

  const threads = useMemo(() => query.data?.threads ?? [], [query.data]);

  const focus = useCallback((threadId: string | null) => {
    setActiveId(threadId);
    if (threadId === null) return;
    setDrafting(false);
    setDraft(null);
    setOpen(true);
  }, []);

  const startDraft = useCallback((anchor: CommentAnchor | null) => {
    setDraft(anchor);
    setDrafting(true);
    setActiveId(null);
    setOpen(true);
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDrafting(false);
  }, []);

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
      drafting,
      startDraft,
      cancelDraft,
      showResolved,
      setShowResolved,
      located,
      reportLocated,
    }),
    [
      pageId,
      threads,
      query.isLoading,
      open,
      activeId,
      focus,
      draft,
      drafting,
      startDraft,
      cancelDraft,
      showResolved,
      located,
      reportLocated,
    ],
  );

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}
