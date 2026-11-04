// Runs in the page (bundled by global-setup.ts): resolves a locator's steps to elements, with the
// role, name and text rules of Testing Library and Playwright, so the specs keep their selectors.
import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import type { Matcher, RoleOptions, Step } from './steps';

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

function matches(value: string, matcher: Matcher, exact: boolean | undefined): boolean {
  if ('re' in matcher) return new RegExp(matcher.re, matcher.flags).test(value);
  if (exact) return normalize(value) === normalize(matcher.str);
  return normalize(value).toLowerCase().includes(normalize(matcher.str).toLowerCase());
}

function hiddenFromTree(el: Element): boolean {
  if (el.closest('[aria-hidden="true"]')) return true;
  return !el.checkVisibility({ visibilityProperty: true });
}

const LANDMARK_SCOPES = 'article, aside, main, nav, section';

// The ARIA rules dom-accessibility-api leaves to the caller: these elements have their role only in context.
function roleOf(el: Element): string | null {
  const role = getRole(el);
  if (el.hasAttribute('role')) return role;
  const tag = el.localName;
  if ((tag === 'section' || tag === 'form') && computeAccessibleName(el) === '') return null;
  if ((tag === 'header' || tag === 'footer') && el.parentElement?.closest(LANDMARK_SCOPES)) return null;
  return role;
}

function ariaState(el: Element, attr: string): string | null {
  return el.getAttribute(attr);
}

function roleStateMatches(el: Element, opts: RoleOptions): boolean {
  if (opts.selected !== undefined && (ariaState(el, 'aria-selected') === 'true') !== opts.selected) return false;
  if (opts.checked !== undefined) {
    const checked = el instanceof HTMLInputElement ? el.checked : ariaState(el, 'aria-checked') === 'true';
    if (checked !== opts.checked) return false;
  }
  if (opts.pressed !== undefined && (ariaState(el, 'aria-pressed') === 'true') !== opts.pressed) return false;
  if (opts.expanded !== undefined && (ariaState(el, 'aria-expanded') === 'true') !== opts.expanded) return false;
  if (opts.level !== undefined) {
    const level = Number(ariaState(el, 'aria-level') ?? /^h([1-6])$/.exec(el.localName)?.[1]);
    if (level !== opts.level) return false;
  }
  return true;
}

// A tree item's or menu item's name leaves out the items nested inside it, as Playwright's does:
// the nested group is reported hidden to the name computation, and to nothing else.
const NESTING_ROLES = new Set(['treeitem', 'menuitem']);
const NESTED = '[role="group"], [role="tree"], [role="menu"], [role="listbox"]';

function nameOf(el: Element, role: string | null): string {
  const nested = role && NESTING_ROLES.has(role) ? new Set(el.querySelectorAll(NESTED)) : new Set<Element>();
  if (nested.size === 0) return computeAccessibleName(el);
  return computeAccessibleName(el, {
    getComputedStyle: (target, pseudo) => {
      const style = window.getComputedStyle(target, pseudo);
      if (!nested.has(target)) return style;
      return new Proxy(style, {
        get(st, key) {
          if (key === 'display') return 'none';
          if (key === 'getPropertyValue') return (name: string) => (name === 'display' ? 'none' : st.getPropertyValue(name));
          const value: unknown = Reflect.get(st, key);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(st) : value;
        },
      });
    },
  });
}

function byRole(root: ParentNode, role: string, opts: RoleOptions): Element[] {
  return [...root.querySelectorAll('*')].filter((el) => {
    if (roleOf(el) !== role) return false;
    if (!opts.includeHidden && hiddenFromTree(el)) return false;
    if (!roleStateMatches(el, opts)) return false;
    return opts.name === undefined || matches(nameOf(el, role), opts.name, opts.exact);
  });
}

const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template', 'head']);

function ownText(el: Element): string {
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
  return el.textContent ?? '';
}

// The smallest elements whose text matches, as Playwright's getByText picks them.
function byText(root: ParentNode, text: Matcher, exact: boolean | undefined): Element[] {
  const hits = [...root.querySelectorAll('*')].filter(
    (el) => !SKIP_TEXT.has(el.localName) && !el.closest('script, style, template') && matches(ownText(el), text, exact),
  );
  const set = new Set(hits);
  return hits.filter((el) => ![...el.querySelectorAll('*')].some((child) => set.has(child)));
}

function labelsOf(el: Element): string[] {
  const out: string[] = [];
  const aria = el.getAttribute('aria-label');
  if (aria) out.push(aria);
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    const text = ids
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    out.push(text);
  }
  if ('labels' in el && (el as HTMLInputElement).labels) {
    for (const label of (el as HTMLInputElement).labels ?? []) out.push(label.textContent ?? '');
  }
  return out;
}

function byLabel(root: ParentNode, text: Matcher, exact: boolean | undefined): Element[] {
  return [...root.querySelectorAll('*')].filter((el) => labelsOf(el).some((label) => matches(label, text, exact)));
}

function byAttr(root: ParentNode, attr: string, value: Matcher, exact: boolean | undefined): Element[] {
  return [...root.querySelectorAll(`[${attr}]`)].filter((el) => matches(el.getAttribute(attr) ?? '', value, exact));
}

function css(root: ParentNode, selector: string): Element[] {
  if (selector === '..') return root instanceof Element && root.parentElement ? [root.parentElement] : [];
  const scoped = /^\s*[>+~]/.test(selector) ? `:scope ${selector}` : selector;
  return [...root.querySelectorAll(scoped)];
}

function stepOnce(root: ParentNode, step: Step): Element[] {
  switch (step.kind) {
    case 'css':
      return css(root, step.selector);
    case 'role':
      return byRole(root, step.role, step.options);
    case 'text':
      return byText(root, step.text, step.exact);
    case 'label':
      return byLabel(root, step.text, step.exact);
    case 'attr':
      return byAttr(root, step.attr, step.value, step.exact);
    default:
      return [];
  }
}

function uniqueInOrder(els: Element[]): Element[] {
  const seen = new Set<Element>();
  const out = els.filter((el) => (seen.has(el) ? false : (seen.add(el), true)));
  return out.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

export function resolve(steps: Step[], scope: ParentNode = document): Element[] {
  let current: ParentNode[] = [scope];
  for (const step of steps) {
    current = applyStep(current as Element[], step);
  }
  return current as Element[];
}

function applyStep(roots: ParentNode[], step: Step): Element[] {
  if (step.kind === 'nth') {
    const index = step.index < 0 ? roots.length + step.index : step.index;
    const el = roots[index];
    return el ? [el as Element] : [];
  }
  if (step.kind === 'filter') {
    return (roots as Element[]).filter((el) => {
      if (step.hasText && !matches(el.textContent ?? '', step.hasText, false)) return false;
      if (step.hasNotText && matches(el.textContent ?? '', step.hasNotText, false)) return false;
      if (step.has && resolve(step.has, el).length === 0) return false;
      if (step.hasNot && resolve(step.hasNot, el).length > 0) return false;
      if (step.visible !== undefined && isVisible(el) !== step.visible) return false;
      return true;
    });
  }
  return uniqueInOrder(roots.flatMap((root) => stepOnce(root, step)));
}

// Playwright's rule: a non-empty box and not visibility:hidden, so display:contents parents count via children.
export function isVisible(el: Element): boolean {
  if (!el.checkVisibility({ visibilityProperty: true })) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return true;
  return getComputedStyle(el).display === 'contents' && [...el.children].some(isVisible);
}

export function isEnabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest('fieldset[disabled]') && !el.closest('legend')) return false;
  return el.closest('[aria-disabled="true"]') === null;
}

export function isEditable(el: Element): boolean {
  if (!isEnabled(el)) return false;
  if ((el as HTMLInputElement).readOnly) return false;
  if (el.getAttribute('aria-readonly') === 'true') return false;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable;
}
