/** The space between the trigger and the menu, and the least the menu keeps from the edge. */
export const MENU_GAP = 4;
export const MENU_MARGIN = 8;

/** Whatever a DOMRect gives us about the control that opened the menu. */
export interface TriggerBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface MenuSpot {
  top: number;
  left: number;
}

/** Line the menu up with the left edge of the trigger, or with its right edge. */
export type MenuAlign = 'left' | 'right';

function clamp(value: number, span: number, size: number): number {
  const last = Math.max(MENU_MARGIN, span - size - MENU_MARGIN);
  return Math.min(Math.max(MENU_MARGIN, value), last);
}

/**
 * Where a menu goes for the control that opened it, in viewport coordinates. It sits under the
 * trigger, flips above when the space below runs out, and stays clear of all four edges.
 */
export function placeMenu(
  trigger: TriggerBox,
  menu: Size,
  view: Size,
  align: MenuAlign = 'left',
): MenuSpot {
  const under = trigger.bottom + MENU_GAP;
  const over = trigger.top - MENU_GAP - menu.height;
  // Above the trigger only when the space below cannot hold the menu and the space above can.
  const tight = under + menu.height > view.height - MENU_MARGIN;
  const top = tight && over > MENU_MARGIN ? over : under;
  const left = align === 'right' ? trigger.right - menu.width : trigger.left;

  return {
    top: clamp(top, view.height, menu.height),
    left: clamp(left, view.width, menu.width),
  };
}
