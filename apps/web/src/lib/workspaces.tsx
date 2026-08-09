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

  const [slug, setSlug] = useState<string | null>(() => currentWorkspace());

  const workspaces = useMemo(() => query.data?.workspaces ?? [], [query.data]);

  const current = useMemo<Workspace | null>(() => {
    const wanted = slug ?? query.data?.current ?? null;
    return workspaces.find((one) => one.slug === wanted) ?? workspaces[0] ?? null;
  }, [workspaces, slug, query.data]);

  // A first visit, or a workspace that was deleted or renamed: settle on what the server sent.
  useEffect(() => {
    if (current === null || current.slug === slug) return;
    setCurrentWorkspace(current.slug);
    setSlug(current.slug);
  }, [current, slug]);

  const value = useMemo<WorkspacesValue>(
    () => ({
      workspaces,
      current,
      isLoading: query.isLoading,
      switchTo: (next: string): void => {
        if (next === current?.slug) return;
        setCurrentWorkspace(next);
        setSlug(next);
        // Nothing cached belongs to the new workspace, down to the page ids.
        client.clear();
        navigate('/');
      },
    }),
    [workspaces, current, query.isLoading, client, navigate],
  );

  return <WorkspacesContext.Provider value={value}>{children}</WorkspacesContext.Provider>;
}
