/** The side panels a page can show. The page menu turns them on, one at a time. */
export type PanelId = 'backlinks' | 'history';

export type PanelState = Record<PanelId, boolean>;

export const NO_PANELS: PanelState = { backlinks: false, history: false };

export function anyPanelOpen(panels: PanelState): boolean {
  return panels.backlinks || panels.history;
}
