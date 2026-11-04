// Locator and page matchers that retry until they hold or EXPECT_TIMEOUT runs out, as the specs expect.
import { expect } from 'vitest';
import { Locator, Page, sleep } from './browser';
import type { Step } from './steps';

export const EXPECT_TIMEOUT = 10_000;

interface Outcome {
  pass: boolean;
  message: () => string;
}

interface Options {
  timeout?: number;
}

// Retries `check` until it gives what the assertion wants (pass, or fail under .not), then reports that.
// vitest leaves isNot undefined on a plain expect, so anything but true means "not negated".
async function retry(negated: boolean | undefined, timeout: number | undefined, check: () => Promise<Outcome>): Promise<Outcome> {
  const isNot = negated === true;
  const deadline = Date.now() + (timeout ?? EXPECT_TIMEOUT);
  let last: Outcome = { pass: isNot, message: () => 'never checked' };
  for (;;) {
    try {
      last = await check();
    } catch (err) {
      // A page that could not be read proves nothing either way, so the assertion fails under .not too.
      const reason = `could not read the page: ${String(err)}`;
      last = { pass: isNot, message: () => reason };
    }
    if (last.pass !== isNot) return last;
    if (Date.now() > deadline) return last;
    await sleep(100);
  }
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

type TextMatch = string | RegExp;

function textMatches(actual: string, expected: TextMatch, contains: boolean): boolean {
  if (expected instanceof RegExp) return expected.test(actual);
  return contains ? normalize(actual).includes(normalize(expected)) : normalize(actual) === normalize(expected);
}

// One element's state, read in a single round trip; `count` lets the strictness rules apply.
interface Snapshot {
  count: number;
  visible: boolean;
  enabled: boolean;
  focused: boolean;
  inViewport: boolean;
  text: string;
  value: string;
  attr: string | null;
  className: string;
  texts: string[];
  found: string[];
}

function snapshot(locator: Locator, attr = ''): Promise<Snapshot> {
  return locator.page().run(
    (steps: Step[], name: string) => {
      const els = window.__e2e.resolve(steps);
      const el = els[0] as HTMLElement | undefined;
      const active = document.activeElement;
      return {
        count: els.length,
        visible: el ? window.__e2e.isVisible(el) : false,
        enabled: el ? window.__e2e.isEnabled(el) : false,
        focused: el ? active === el : false,
        inViewport: el ? window.__e2e.inViewport(el) : false,
        text: el?.textContent ?? '',
        value: el ? ((el as HTMLInputElement).value ?? '') : '',
        attr: el && name ? el.getAttribute(name) : null,
        className: el?.getAttribute('class') ?? '',
        texts: els.map((e) => e.textContent ?? ''),
        found: els.length > 1 ? window.__e2e.describeAll(steps) : [],
      };
    },
    locator.steps,
    attr,
  );
}

function strict(s: Snapshot, locator: Locator): string | null {
  if (s.count > 1) return `strict mode: ${String(s.count)} elements match ${locator.toString()}: ${s.found.join(', ')}`;
  return null;
}

function single(locator: Locator, isNot: boolean | undefined, opts: Options | undefined, test: (s: Snapshot) => boolean, what: string, attr = '') {
  return retry(isNot, opts?.timeout, async () => {
    const s = await snapshot(locator, attr);
    const err = strict(s, locator);
    if (err) return { pass: false, message: () => err };
    const pass = s.count === 1 && test(s);
    return { pass, message: () => `${locator.toString()} ${isNot === true ? 'is still' : 'is not'} ${what} (matches: ${String(s.count)}, text: ${JSON.stringify(normalize(s.text).slice(0, 200))})` };
  });
}

function asLocator(received: unknown): Locator {
  if (received instanceof Locator) return received;
  throw new Error('expected a locator');
}

function textAssertion(contains: boolean) {
  return async function (this: { isNot: boolean }, received: unknown, expected: TextMatch | TextMatch[], opts?: Options) {
    const locator = asLocator(received);
    if (Array.isArray(expected)) {
      return retry(this.isNot, opts?.timeout, async () => {
        const s = await snapshot(locator);
        const texts = s.texts;
        const pass = texts.length === expected.length && expected.every((e, i) => textMatches(texts[i] ?? '', e, contains));
        return { pass, message: () => `${locator.toString()} texts are ${JSON.stringify(texts.map(normalize))}, expected ${String(expected)}` };
      });
    }
    return single(
      locator,
      this.isNot,
      opts,
      (s) => textMatches(s.text, expected, contains),
      `${contains ? 'containing' : 'with text'} ${String(expected)}`,
    );
  };
}

expect.extend({
  toBeVisible(received: unknown, opts?: Options) {
    const locator = asLocator(received);
    if (!this.isNot) return single(locator, false, opts, (s) => s.visible, 'visible');
    // Under .not, no match at all also passes, as Playwright's toBeHidden does.
    return retry(true, opts?.timeout, async () => {
      const s = await snapshot(locator);
      return { pass: s.count > 0 && s.visible, message: () => `${locator.toString()} is still visible` };
    });
  },
  toBeHidden(received: unknown, opts?: Options) {
    const locator = asLocator(received);
    return retry(this.isNot, opts?.timeout, async () => {
      const s = await snapshot(locator);
      return { pass: s.count === 0 || !s.visible, message: () => `${locator.toString()} is ${this.isNot ? 'hidden' : 'visible'}` };
    });
  },
  toHaveCount(received: unknown, expected: number, opts?: Options) {
    const locator = asLocator(received);
    return retry(this.isNot, opts?.timeout, async () => {
      const count = await locator.count();
      return { pass: count === expected, message: () => `${locator.toString()} has ${String(count)} matches, expected ${this.isNot ? 'not ' : ''}${String(expected)}` };
    });
  },
  toHaveText: textAssertion(false),
  toContainText: textAssertion(true),
  toHaveValue(received: unknown, expected: TextMatch, opts?: Options) {
    return single(asLocator(received), this.isNot, opts, (s) => (expected instanceof RegExp ? expected.test(s.value) : s.value === expected), `with value ${String(expected)}`);
  },
  toHaveAttribute(received: unknown, name: string, expected?: TextMatch, opts?: Options) {
    return single(
      asLocator(received),
      this.isNot,
      opts,
      (s) => (expected === undefined ? s.attr !== null : s.attr !== null && (expected instanceof RegExp ? expected.test(s.attr) : s.attr === expected)),
      `with ${name}=${String(expected)}`,
      name,
    );
  },
  toHaveClass(received: unknown, expected: TextMatch, opts?: Options) {
    return single(asLocator(received), this.isNot, opts, (s) => (expected instanceof RegExp ? expected.test(s.className) : s.className === expected), `with class ${String(expected)}`);
  },
  toBeDisabled(received: unknown, opts?: Options) {
    return single(asLocator(received), this.isNot, opts, (s) => !s.enabled, 'disabled');
  },
  toBeFocused(received: unknown, opts?: Options) {
    return single(asLocator(received), this.isNot, opts, (s) => s.focused, 'focused');
  },
  toBeInViewport(received: unknown, opts?: Options) {
    return single(asLocator(received), this.isNot, opts, (s) => s.inViewport, 'in the viewport');
  },
  toHaveURL(received: unknown, expected: TextMatch, opts?: Options) {
    if (!(received instanceof Page)) throw new Error('toHaveURL expects a page');
    return retry(this.isNot, opts?.timeout, async () => {
      const url = await received.url();
      const want = typeof expected === 'string' ? new URL(expected, url).href : expected;
      const pass = typeof want === 'string' ? url === want : want.test(url);
      return { pass, message: () => `the page is at ${url}, expected ${String(expected)}` };
    });
  },
  toHaveTitle(received: unknown, expected: TextMatch, opts?: Options) {
    if (!(received instanceof Page)) throw new Error('toHaveTitle expects a page');
    return retry(this.isNot, opts?.timeout, async () => {
      const title = await received.title();
      const pass = textMatches(title, expected, false);
      return { pass, message: () => `the title is ${JSON.stringify(title)}, expected ${String(expected)}` };
    });
  },
  // Retries a block of assertions until it stops throwing.
  async toPass(received: unknown, opts?: Options) {
    if (typeof received !== 'function') throw new Error('toPass expects a function');
    return retry(this.isNot, opts?.timeout, async () => {
      await (received as () => Promise<unknown>)();
      return { pass: true, message: () => 'the block passed' };
    });
  },
});

interface LocatorMatchers<R> {
  toBeVisible(opts?: Options): Promise<R>;
  toBeHidden(opts?: Options): Promise<R>;
  toHaveCount(n: number, opts?: Options): Promise<R>;
  toHaveText(expected: TextMatch | TextMatch[], opts?: Options): Promise<R>;
  toContainText(expected: TextMatch | TextMatch[], opts?: Options): Promise<R>;
  toHaveValue(expected: TextMatch, opts?: Options): Promise<R>;
  toHaveAttribute(name: string, expected?: TextMatch, opts?: Options): Promise<R>;
  toHaveClass(expected: TextMatch, opts?: Options): Promise<R>;
  toBeDisabled(opts?: Options): Promise<R>;
  toBeFocused(opts?: Options): Promise<R>;
  toBeInViewport(opts?: Options): Promise<R>;
  toHaveURL(expected: TextMatch, opts?: Options): Promise<R>;
  toHaveTitle(expected: TextMatch, opts?: Options): Promise<R>;
  toPass(opts?: Options): Promise<R>;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- vitest's own augmentation pattern
  interface Assertion<T> extends LocatorMatchers<T> {}
}

export { expect };
