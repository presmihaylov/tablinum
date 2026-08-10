import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@tablinum/shared';
import { useWorkspaces as useWorkspacesQuery } from '../api/hooks';
import { currentWorkspace, setCurrentWorkspace } from './currentWorkspace';

/**
 * Which workspace the app is in.
 *
 * A workspace owns its own pages, spaces, search index and live channel, so switching to
 * another one throws away everything cached about this one and starts again from its home.
 */

interface WorkspacesValue {
  workspaces: Workspace[];
  current: Workspace | null;
  isLoading: boolean;
  /** Move this tab to another workspace. Safe to call with the one already open. */
  switchTo: (slug: string) => void;
}

const IDLE: WorkspacesValue = {
  workspaces: [],
  current: null,
  isLoading: false,
  switchTo: () => undefined,
};

const WorkspacesContext = createContext<WorkspacesValue>(IDLE);

export function useWorkspace(): WorkspacesValue {
  return useContext(WorkspacesContext);
}

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const query = useWorkspacesQuery();

  // The key this tab holds settles on the workspace id. A rename changes the slug, and a request
  // that still carried the old one was refused, which signed the reader out of a workspace they
  // had just renamed. An id outlives every rename. A slug stored by an older build still resolves.
  const [key, setKey] = useState<string | null>(() => currentWorkspace());

  const workspaces = useMemo(() => query.data?.workspaces ?? [], [query.data]);

  const current = useMemo<Workspace | null>(() => {
    const wanted = key ?? query.data?.current ?? null;
    const found = workspaces.find((one) => one.id === wanted || one.slug === wanted);
    return found ?? workspaces[0] ?? null;
  }, [workspaces, key, query.data]);

  // A first visit, or a workspace that was deleted: settle on what the server sent. Never while
  // the list is in flight: one just made or just renamed is missing from the answer in hand, and
  // overwriting the choice with a stale row sends the tab back where it came from.
  useEffect(() => {
    if (query.isFetching) return;
    if (current === null || current.id === key) return;
    setCurrentWorkspace(current.id);
    setKey(current.id);
  }, [current, key, query.isFetching]);

  const value = useMemo<WorkspacesValue>(
    () => ({
      workspaces,
      current,
      isLoading: query.isLoading,
      switchTo: (next: string): void => {
        if (next === current?.id || next === current?.slug) return;
        setCurrentWorkspace(next);
        setKey(next);
        // Nothing cached belongs to the new workspace, down to the page ids.
        client.clear();
        navigate('/');
      },
    }),
    [workspaces, current, query.isLoading, client, navigate],
  );

  return <WorkspacesContext.Provider value={value}>{children}</WorkspacesContext.Provider>;
}
