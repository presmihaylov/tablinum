import { describe, expect, it } from 'vitest';
import { MENU_GAP, MENU_MARGIN, placeMenu, type Size, type TriggerBox } from '../src/lib/menuPlacement';

/**
 * Where a menu lands for the control that opened it. Every menu the app draws on the body asks
 * this, so a menu never hangs off an edge of the window.
 */

const VIEW: Size = { width: 1280, height: 800 };

function trigger(left: number, top: number, width = 28, height = 28): TriggerBox {
  return { left, top, right: left + width, bottom: top + height };
}

function inside(spot: { top: number; left: number }, menu: Size, view: Size): boolean {
  return (
    spot.left >= 0 &&
    spot.top >= 0 &&
    spot.left + menu.width <= view.width &&
    spot.top + menu.height <= view.height
  );
}

describe('placing a menu', () => {
  it('hangs it under the trigger, lined up on the left', () => {
    const spot = placeMenu(trigger(400, 100), { width: 240, height: 180 }, VIEW);

    expect(spot).toEqual({ top: 128 + MENU_GAP, left: 400 });
  });

  it('lines it up on the right edge of the trigger when asked', () => {
    const spot = placeMenu(trigger(900, 100), { width: 240, height: 180 }, VIEW, 'right');

    expect(spot.left).toBe(928 - 240);
  });

  // The avatar sits at the left of a 15.5rem sidebar, and its menu is 15rem wide. Hung off the
  // right edge of the avatar, the menu used to start at a negative left and run off the screen.
  it('keeps a right-aligned menu on screen beside a trigger near the left edge', () => {
    const menu = { width: 240, height: 180 };
    const spot = placeMenu(trigger(180, 8), menu, VIEW, 'right');

    expect(spot.left).toBe(MENU_MARGIN);
    expect(inside(spot, menu, VIEW)).toBe(true);
  });

  it('keeps a menu clear of the right edge', () => {
    const menu = { width: 240, height: 180 };
    const spot = placeMenu(trigger(1260, 100), menu, VIEW);

    expect(spot.left).toBe(VIEW.width - menu.width - MENU_MARGIN);
    expect(inside(spot, menu, VIEW)).toBe(true);
  });

  it('flips above the trigger when the space below runs out', () => {
    const menu = { width: 240, height: 180 };
    const spot = placeMenu(trigger(400, 700), menu, VIEW);

    expect(spot.top).toBe(700 - MENU_GAP - menu.height);
    expect(inside(spot, menu, VIEW)).toBe(true);
  });

  it('holds a tall menu inside a short window', () => {
    const view = { width: 420, height: 320 };
    const menu = { width: 240, height: 260 };
    const spot = placeMenu(trigger(30, 260), menu, view, 'right');

    // Neither above nor below holds it, so it gives up the gap and sits inside the window.
    expect(spot.left).toBe(MENU_MARGIN);
    expect(inside(spot, menu, view)).toBe(true);
  });

  it('stays on screen wherever the trigger sits, either way up', () => {
    const menu = { width: 240, height: 180 };
    for (const left of [0, 40, 300, 1000, 1252]) {
      for (const top of [0, 200, 500, 772]) {
        for (const align of ['left', 'right'] as const) {
          const spot = placeMenu(trigger(left, top), menu, VIEW, align);
          expect(inside(spot, menu, VIEW)).toBe(true);
        }
      }
    }
  });
});
