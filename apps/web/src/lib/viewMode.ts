import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type ViewMode = 'page' | 'table';

/** Centre-pane mode, kept in the URL so a table view can be linked to. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [params, setParams] = useSearchParams();
  const mode: ViewMode = params.get('view') === 'table' ? 'table' : 'page';

  const setMode = useCallback(
    (next: ViewMode) => {
      const updated = new URLSearchParams(params);
      if (next === 'page') updated.delete('view');
      if (next === 'table') updated.set('view', 'table');
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  return [mode, setMode];
}
