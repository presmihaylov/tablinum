import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageId, UpdatePageBody } from '@gitdocs/shared';
import { useUpdatePage } from '../api/hooks';
import { Autosave, type SaveState } from './autosave';

export interface AutosaveHandle {
  saveState: SaveState;
  /** Merge an edit into the pending patch. Debounced by the controller. */
  queue: (patch: UpdatePageBody) => void;
  flush: () => Promise<void>;
  isDirty: () => boolean;
}

const UNLOAD_WARNING = 'You have unsaved changes.';

/** Autosave for one page. Lives in the shell so the editor stays stateless about saving. */
export function useAutosave(pageId: PageId | undefined): AutosaveHandle {
  const updatePage = useUpdatePage();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const controllerRef = useRef<Autosave | null>(null);

  // The mutation object is new every render; the controller reads it through a ref.
  const mutateRef = useRef(updatePage.mutateAsync);
  mutateRef.current = updatePage.mutateAsync;

  useEffect(() => {
    if (!pageId) {
      controllerRef.current = null;
      return;
    }
    const controller = new Autosave({
      save: (patch) => mutateRef.current({ id: pageId, body: patch }),
      onState: setSaveState,
    });
    controllerRef.current = controller;
    setSaveState('idle');

    return () => {
      controllerRef.current = null;
      void controller.flush().finally(() => controller.dispose());
    };
  }, [pageId]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!controllerRef.current?.dirty) return;
      event.preventDefault();
      event.returnValue = UNLOAD_WARNING;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const queue = useCallback((patch: UpdatePageBody) => {
    controllerRef.current?.queue(patch);
  }, []);

  const flush = useCallback(async () => {
    await controllerRef.current?.flush();
  }, []);

  const isDirty = useCallback(() => controllerRef.current?.dirty ?? false, []);

  return { saveState, queue, flush, isDirty };
}
