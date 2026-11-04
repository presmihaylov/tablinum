// The bundle's entry: what the node side calls through `window.__e2e` in every page.
import { isEditable, isEnabled, isVisible, resolve } from './dom-query';
import type { Step } from './steps';

const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

export interface Target {
  ok: boolean;
  reason?: string;
  x: number;
  y: number;
}

// Playwright's actionability: visible, enabled, stable for two frames, and the topmost element at the point.
async function target(el: Element, position?: { x: number; y: number }, needEnabled = true, force = false): Promise<Target> {
  const fail = (reason: string): Target => ({ ok: false, reason, x: 0, y: 0 });
  if (!el.isConnected) return fail('element is detached');
  if (!isVisible(el)) return fail('element is not visible');
  if (needEnabled && !isEnabled(el)) return fail('element is disabled');
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const first = el.getBoundingClientRect();
  await frame();
  await frame();
  const rect = el.getBoundingClientRect();
  if (first.x !== rect.x || first.y !== rect.y || first.width !== rect.width || first.height !== rect.height) {
    return fail('element is not stable');
  }
  const x = rect.x + (position ? position.x : rect.width / 2);
  const y = rect.y + (position ? position.y : rect.height / 2);
  if (!force) {
    const hit = el.ownerDocument.elementFromPoint(x, y);
    const label = el instanceof HTMLInputElement ? [...(el.labels ?? [])] : [];
    if (!hit || !(el === hit || el.contains(hit) || label.some((l) => l === hit || l.contains(hit)))) {
      return fail(`another element would receive the click: ${hit ? describe(hit) : 'nothing'}`);
    }
  }
  return { ok: true, x, y };
}

function describe(el: Element): string {
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
  return `<${el.localName}${el.id ? `#${el.id}` : ''}${cls}>`;
}

// Playwright's hit-target check, at the moment the press arrives: a press that would land on another
// element (the list re-rendered under the pointer) is stopped before the page sees it, and retried.
const GUARDED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const;
let guard: { el: Element; hit: boolean | null; stop: (e: Event) => void } | null = null;

function owns(el: Element, target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  if (el === target || el.contains(target)) return true;
  const labels = el instanceof HTMLInputElement ? [...(el.labels ?? [])] : [];
  return labels.some((l) => l === target || l.contains(target));
}

function arm(el: Element) {
  disarm();
  const state = {
    el,
    hit: null as boolean | null,
    stop: (e: Event) => {
      if (state.hit === null) state.hit = owns(el, e.target);
      if (state.hit) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
  };
  for (const type of GUARDED) window.addEventListener(type, state.stop, true);
  guard = state;
}

function disarm(): boolean | null {
  if (!guard) return null;
  for (const type of GUARDED) window.removeEventListener(type, guard.stop, true);
  const hit = guard.hit;
  guard = null;
  return hit;
}

// Playwright's fill: focus, select everything the field holds, so the next keystroke or insert replaces it.
function selectAll(el: Element): string | null {
  if (!isEditable(el)) return 'element is not editable';
  (el as HTMLElement).focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select();
    return null;
  }
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const selection = el.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return null;
}

function box(el: Element) {
  if (!isVisible(el)) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function inViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && r.width > 0 && r.height > 0;
}

function describeAll(steps: Step[]): string[] {
  return resolve(steps).slice(0, 5).map(describe);
}

// esbuild's keepNames wraps serialized functions in __name(); in the page it only has to return them.
Object.assign(window, {
  __name: <T>(fn: T) => fn,
  __e2e: { resolve, isVisible, isEnabled, isEditable, target, selectAll, box, inViewport, describeAll, arm, disarm },
});
