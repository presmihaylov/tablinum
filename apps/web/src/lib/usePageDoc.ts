import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Page, PageId, UpdatePageBody } from '@gitdocs/shared';
import { api, saveConflictOf } from '../api/client';
import { useUpdatePage } from '../api/hooks';
import { qk } from '../api/keys';
import { Autosave, type SaveState } from './autosave';
import { useLive } from './live';
import { LiveDoc, type DocConflict } from './livedoc';

/** Text the editor must adopt. It changes only when `token` changes. */
export interface IncomingContent {
  markdown: string;
  title: string;
  token: number;
}

export interface PageDocHandle {
  saveState: SaveState;
  /** Null until something arrives from elsewhere. */
  incoming: IncomingContent | null;
  conflict: DocConflict | null;
  queueMarkdown: (markdown: string) => void;
  queueTitle: (title: string) => void;
  flush: () => Promise<void>;
  isDirty: () => boolean;
  /** Take the text the user chose in the conflict dialog and save it. */
  resolveConflict: (markdown: string) => void;
}

const UNLOAD_WARNING = 'You have unsaved changes.';

/** A save that keeps losing the race is a bug, not a retry. */
const MAX_SAVE_ATTEMPTS = 4;

/**
 * One page, saved and kept in step with everyone else editing it. A save carries the revision
 * it started from; the server rejects a stale one, and the rejection carries the current text,
 * so the two edits are merged here and saved again.
 */
export function usePageDoc(page: Page | undefined): PageDocHandle {
  const client = useQueryClient();
  const updatePage = useUpdatePage();
  const live = useLive();

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [incoming, setIncoming] = useState<IncomingContent | null>(null);
  const [conflict, setConflict] = useState<DocConflict | null>(null);

  const docRef = useRef<LiveDoc | null>(null);
  const controllerRef = useRef<Autosave | null>(null);
  const tokenRef = useRef(0);

  const updateRef = useRef(updatePage.mutateAsync);
  updateRef.current = updatePage.mutateAsync;

  const setEditingRef = useRef(live.setEditing);
  setEditingRef.current = live.setEditing;

  const pageId = page?.id;
  const pageMarkdown = page?.markdown ?? '';
  const pageRev = page?.rev ?? '';
  const pageTitle = page?.title ?? '';

  // The page object is new after every save; only a different id starts a new document.
  const seed = useRef({ id: pageId, markdown: pageMarkdown, rev: pageRev, title: pageTitle });
  seed.current = { id: pageId, markdown: pageMarkdown, rev: pageRev, title: pageTitle };

  useEffect(() => {
    if (pageId === undefined) {
      docRef.current = null;
      controllerRef.current = null;
      return;
    }

    const doc = new LiveDoc({
      markdown: seed.current.markdown,
      rev: seed.current.rev,
      title: seed.current.title,
      onAdopt: (markdown, title) => {
        tokenRef.current += 1;
        setIncoming({ markdown, title, token: tokenRef.current });
      },
      onConflict: setConflict,
    });

    const controller = new Autosave({
      save: (patch) => save(pageId, doc, patch),
      onState: (state) => {
        setSaveState(state);
        if (state === 'saved' || state === 'idle') setEditingRef.current(false);
      },
    });

    docRef.current = doc;
    controllerRef.current = controller;
    setSaveState('idle');
    setIncoming(null);
    setConflict(null);

    return () => {
      docRef.current = null;
      controllerRef.current = null;
      void controller.flush().finally(() => controller.dispose());
    };
    // `save` is a module-level function, so the controller is rebuilt only on a page change.
  }, [pageId]);

  /** Fetch the page and fold it into the local copy. */
  const pullRemote = useCallback(
    async (id: PageId, fromGit: boolean): Promise<void> => {
      const doc = docRef.current;
      if (doc === null) return;
      let data;
      try {
        data = await api.getPage(id);
      } catch {
        // A page that cannot be read right now is retried by the next message.
        return;
      }
      if (docRef.current !== doc) return;

      client.setQueryData(qk.page(id), data);
      client.setQueryData(qk.pageByPath(data.page.path), data);

      const outcome = doc.reconcile(
        { markdown: data.page.markdown, rev: data.page.rev, title: data.page.title },
        fromGit ? 'git' : 'peer',
      );
      // A merge only lives in this tab until it is written back.
      if (outcome.kind === 'merged') controllerRef.current?.queue({ markdown: outcome.text });
    },
    [client],
  );

  useEffect(() => {
    if (pageId === undefined) return;
    return live.subscribePage(pageId, (message) => {
      if (message.rev === docRef.current?.rev) return;
      void pullRemote(pageId, message.source === 'pull');
    });
  }, [pageId, live.subscribePage, pullRemote]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (controllerRef.current?.dirty !== true) return;
      event.preventDefault();
      event.returnValue = UNLOAD_WARNING;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const queueMarkdown = useCallback((markdown: string) => {
    docRef.current?.edit(markdown);
    setEditingRef.current(true);
    controllerRef.current?.queue({ markdown });
  }, []);

  const queueTitle = useCallback((title: string) => {
    docRef.current?.editTitle(title);
    setEditingRef.current(true);
    controllerRef.current?.queue({ title });
  }, []);

  const flush = useCallback(async () => {
    await controllerRef.current?.flush();
  }, []);

  const isDirty = useCallback(() => controllerRef.current?.dirty ?? false, []);

  const resolveConflict = useCallback((markdown: string) => {
    const resolved = docRef.current?.resolve(markdown);
    if (resolved === null || resolved === undefined) return;
    controllerRef.current?.queue({ markdown: resolved });
  }, []);

  return { saveState, incoming, conflict, queueMarkdown, queueTitle, flush, isDirty, resolveConflict };

  /**
   * Send one patch, merging and retrying while the server says the page moved on.
   * Kept inside the hook so it can reach the mutation ref without being rebuilt.
   */
  async function save(id: PageId, doc: LiveDoc, patch: UpdatePageBody): Promise<void> {
    let body: UpdatePageBody = patch.markdown === undefined ? patch : { ...patch, baseRev: doc.rev };

    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      try {
        const result = await updateRef.current({ id, body });
        if (body.markdown !== undefined) doc.accept(body.markdown, result.page.rev);
        if (body.title !== undefined) doc.acceptTitle(result.page.title);
        return;
      } catch (err) {
        const info = saveConflictOf(err);
        if (info === null) throw err;

        const outcome = doc.reconcile({ markdown: info.markdown, rev: info.rev }, 'peer');
        // The user has to choose; the dialog is up and the retry would only fail again.
        if (outcome.kind === 'blocked') throw err;
        if (outcome.kind !== 'merged') return;
        body = { ...body, markdown: outcome.text, baseRev: doc.rev };
      }
    }

    throw new Error('The page kept changing while this edit was saved.');
  }
}
