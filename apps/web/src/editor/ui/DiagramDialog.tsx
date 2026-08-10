import { Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';

declare global {
  interface Window {
    /** Where Excalidraw loads its fonts from. Set before the canvas module is imported. */
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

/**
 * Self-hosted by the Vite plugin in vite.config.ts. Without it Excalidraw calls esm.sh.
 * It sits under the bundle directory so a missing font 404s instead of getting index.html.
 */
const ASSET_PATH = '/assets/excalidraw/';

const DiagramBoard = lazy(async () => {
  window.EXCALIDRAW_ASSET_PATH = ASSET_PATH;
  return import('./DiagramBoard');
});

export interface DiagramDialogProps {
  /** The drawing to open, or null while the dialog is shut. */
  scene: { src: string | null } | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (svg: string) => void;
}

/**
 * The drawing canvas in an overlay. It deliberately does not close on Escape or on a click
 * outside: Excalidraw uses Escape itself, and a stray press must not throw a drawing away.
 */
export function DiagramDialog({ scene, saving, onCancel, onSave }: DiagramDialogProps) {
  if (scene === null) return null;

  return createPortal(
    <div className="overlay" role="presentation">
      <div className="modal gd-editor-diagram-modal" role="dialog" aria-modal="true" aria-label="Diagram">
        <header className="modal__head">
          <h2 className="modal__title">Diagram</h2>
        </header>
        <div className="modal__body gd-editor-diagram-modal__body">
          <Suspense fallback={<p className="gd-editor-board__note">Loading the canvas…</p>}>
            <DiagramBoard src={scene.src} saving={saving} onCancel={onCancel} onSave={onSave} />
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default DiagramDialog;
