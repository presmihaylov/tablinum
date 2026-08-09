import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { LivePresence, PageChangedMessage, PageId, PagePath, ServerMessage } from '@gitdocs/shared';
import { invalidateContent } from '../api/hooks';
import { qk } from '../api/keys';
import { myClientId } from './identity';
import { pathFromSplat } from './href';
import { LiveConnection } from './liveClient';

/** What one page's editor is told when its bytes change somewhere else. */
export type PageListener = (message: PageChangedMessage) => void;

interface LiveValue {
  connected: boolean;
  /** Everyone on the page this tab is watching, including this tab. */
  presence: LivePresence[];
  /** Tell the others that this tab has unsaved edits. */
  setEditing: (editing: boolean) => void;
  /** Listen for changes to one page, made by anyone else. Returns an unsubscribe function. */
  subscribePage: (id: PageId, listener: PageListener) => () => void;
}

const IDLE: LiveValue = {
  connected: false,
  presence: [],
  setEditing: () => undefined,
  subscribePage: () => () => undefined,
};

const LiveContext = createContext<LiveValue>(IDLE);

/** The live channel is optional: without a provider the app still works, just without updates. */
export function useLive(): LiveValue {
  return useContext(LiveContext);
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const location = useLocation();
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<LivePresence[]>([]);

  const connectionRef = useRef<LiveConnection | null>(null);
  const listenersRef = useRef(new Map<PageId, Set<PageListener>>());
  const wasConnected = useRef(false);

  const path = useMemo<PagePath | null>(() => {
    if (!location.pathname.startsWith('/p/')) return null;
    return pathFromSplat(location.pathname.slice('/p/'.length)) || null;
  }, [location.pathname]);

  const pathRef = useRef(path);
  pathRef.current = path;

  const handle = useCallback(
    (message: ServerMessage): void => {
      if (message.type === 'git') {
        client.setQueryData(qk.gitStatus, { status: message.status });
        return;
      }
      if (message.type === 'presence') {
        if (message.path !== pathRef.current) return;
        setPresence(message.users);
        return;
      }
      if (message.type === 'removed') {
        invalidateContent(client);
        return;
      }
      if (message.type !== 'page') return;
      // Our own write comes back to us too; the tab that made it already has the bytes.
      if (message.by === myClientId()) return;

      void client.invalidateQueries({ queryKey: qk.page(message.id) });
      void client.invalidateQueries({ queryKey: qk.pageByPath(message.path) });
      void client.invalidateQueries({ queryKey: qk.tree });
      void client.invalidateQueries({ queryKey: qk.pages });

      for (const listener of [...(listenersRef.current.get(message.id) ?? [])]) listener(message);
    },
    [client],
  );

  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    const connection = new LiveConnection();
    connectionRef.current = connection;

    const offMessage = connection.onMessage((message) => handleRef.current(message));
    const offStatus = connection.onStatus((up) => {
      setConnected(up);
      if (!up) setPresence([]);
      // A gap in the socket is a gap in the updates, so re-read everything once it heals.
      if (up && wasConnected.current) invalidateContent(client);
      if (up) wasConnected.current = true;
    });

    connection.start();
    return () => {
      offMessage();
      offStatus();
      connection.stop();
      connectionRef.current = null;
    };
  }, [client]);

  useEffect(() => {
    setPresence([]);
    connectionRef.current?.watch(path);
  }, [path]);

  const setEditing = useCallback((editing: boolean) => {
    connectionRef.current?.setEditing(editing);
  }, []);

  const subscribePage = useCallback((id: PageId, listener: PageListener) => {
    const listeners = listenersRef.current;
    const forPage = listeners.get(id) ?? new Set<PageListener>();
    forPage.add(listener);
    listeners.set(id, forPage);
    return () => {
      forPage.delete(listener);
      if (forPage.size === 0) listeners.delete(id);
    };
  }, []);

  const value = useMemo<LiveValue>(
    () => ({ connected, presence, setEditing, subscribePage }),
    [connected, presence, setEditing, subscribePage],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
