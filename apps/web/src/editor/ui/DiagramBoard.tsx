import { useEffect, useRef, useState } from 'react';
import { Excalidraw, exportToSvg, loadFromBlob } from '@excalidraw/excalidraw';
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import { useTheme } from '../../lib/theme';
import '@excalidraw/excalidraw/index.css';

export interface DiagramBoardProps {
  /** The scene to reopen, or null for a blank canvas. */
  src: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (svg: string) => void;
}

type Status = 'loading' | 'ready' | 'failed';

/**
 * The drawing canvas. Everything heavy lives in this module and nothing else imports it
 * statically, so a page with no diagram never downloads any of it.
 */
export function DiagramBoard({ src, saving, onCancel, onSave }: DiagramBoardProps) {
  const { resolved } = useTheme();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
  const [status, setStatus] = useState<Status>(src === null ? 'ready' : 'loading');
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (src === null) return;
    let live = true;
    loadScene(src).then(
      (scene) => {
        if (!live) return;
        setInitial(scene);
        setStatus('ready');
      },
      () => {
        if (live) setStatus('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [src]);

  const save = (): void => {
    const api = apiRef.current;
    if (!api) return;
    setFailure(null);
    toSvg(api).then(onSave, () => setFailure('The drawing could not be saved.'));
  };

  return (
    <div className="gd-editor-board">
      <div className="gd-editor-board__canvas">
        {status === 'loading' ? (
          <p className="gd-editor-board__note">Loading the drawing…</p>
        ) : null}
        {status === 'failed' ? (
          <p className="gd-editor-board__note">This drawing could not be read.</p>
        ) : null}
        {status === 'ready' ? (
          <Excalidraw
            theme={resolved}
            {...(initial ? { initialData: initial } : {})}
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
          />
        ) : null}
      </div>
      <div className="gd-editor-board__actions">
        {failure ? <p className="gd-editor-board__error">{failure}</p> : null}
        <button type="button" className="btn btn--outline" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={save}
          disabled={saving || status !== 'ready'}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** The stored SVG carries the scene, so reopening a drawing is a plain fetch and a decode. */
async function loadScene(url: string): Promise<ExcalidrawInitialDataState> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`The diagram could not be read: ${response.status}`);
  const restored = await loadFromBlob(await response.blob(), null, null);
  return { elements: restored.elements, files: restored.files, scrollToContent: true };
}

async function toSvg(api: ExcalidrawImperativeAPI): Promise<string> {
  const options = {
    elements: api.getSceneElements(),
    files: api.getFiles(),
    // exportEmbedScene is what makes one file both the picture and the drawing. The
    // background stays transparent so the page's own theme shows through.
    appState: { exportEmbedScene: true, exportBackground: false, exportWithDarkMode: false },
  };
  // Inlining the fonts runs a WebAssembly subsetter. Where that is blocked the export still
  // succeeds without it, and the text falls back to a system font outside this app.
  const svg = await exportToSvg(options).catch(() =>
    exportToSvg({ ...options, skipInliningFonts: true }),
  );
  return new XMLSerializer().serializeToString(svg);
}

export default DiagramBoard;
