// The WebdriverIO side: one Chromium session per context, and lazy locators that resolve in the page
// and retry until the element is ready, so the specs read as they did on Playwright.
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remote } from 'webdriverio';
import { combo, keyValue } from './keys';
import { matcher, type RoleOptions, type Step } from './steps';
import { Http, type Cookie, type RequestOptions } from './http';
import { BUNDLE_FILE, DRIVER_PORT } from '../env';

type WdioBrowser = Awaited<ReturnType<typeof remote>>;
type Ref = Record<string, string>;

export const ACTION_TIMEOUT = 20_000;
const POLL_MS = 100;

let bundle: string | undefined;
const inPageSource = () => (bundle ??= readFileSync(BUNDLE_FILE, 'utf8'));

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const CHROME_ARGS = ['--headless=new', '--window-size=1280,720', '--disable-dev-shm-usage', '--no-first-run'];

export interface ContextOptions {
  baseURL: string;
  cookies?: Cookie[];
  viewport?: { width: number; height: number };
}

export async function newSession(options: ContextOptions): Promise<BrowserContext> {
  const binary = process.env.CHROME_BIN ?? '/usr/local/bin/chromium';
  const browser = await remote({
    hostname: '127.0.0.1',
    port: DRIVER_PORT,
    path: '/',
    logLevel: 'error',
    connectionRetryCount: 1,
    capabilities: {
      browserName: 'chrome',
      webSocketUrl: true,
      unhandledPromptBehavior: 'dismiss',
      'goog:chromeOptions': { binary, args: CHROME_ARGS },
    },
  });
  const context = new BrowserContext(browser, options);
  await context.init();
  return context;
}

interface BidiHandler {
  send(params: { method: string; params: unknown }): Promise<{ result: Record<string, unknown> }>;
}

interface DragData {
  dragOperationsMask: number;
  items: { mimeType: string; data: string }[];
}

// The page's own CDP session, reached over WebDriver BiDi: mouse input and drag interception must
// share one session, and only BiDi forwards that session's events. WebdriverIO keeps its BiDi
// connection internal, so this reaches for it by name.
export class Cdp {
  private session = '';
  drag: DragData | null = null;

  constructor(private readonly wdio: WdioBrowser) {}

  private get bidi(): BidiHandler {
    const handler = (this.wdio as unknown as { _bidiHandler?: BidiHandler })._bidiHandler;
    if (!handler) throw new Error('the session has no WebDriver BiDi connection');
    return handler;
  }

  async init() {
    const context = await this.wdio.getWindowHandle();
    const reply = await this.bidi.send({ method: 'goog:cdp.getSession', params: { context } });
    this.session = String(reply.result.session);
    await this.wdio.sessionSubscribe({ events: ['goog:cdp.Input.dragIntercepted'] });
    this.wdio.on('goog:cdp.Input.dragIntercepted' as never, ((event: { session?: string; params: { data: DragData } }) => {
      if (event.session === this.session) this.drag = event.params.data;
    }) as never);
  }

  send(method: string, params: Record<string, unknown>) {
    return this.bidi.send({ method: 'goog:cdp.sendCommand', params: { method, params, session: this.session } });
  }
}

export interface BrowserCookie extends Cookie {
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  expires?: number;
}

export class BrowserContext {
  readonly page: Page;
  readonly cdp: Cdp;
  viewport: { width: number; height: number };

  constructor(
    readonly wdio: WdioBrowser,
    readonly options: ContextOptions,
  ) {
    this.viewport = options.viewport ?? { width: 1280, height: 720 };
    this.cdp = new Cdp(wdio);
    this.page = new Page(this);
  }

  async init() {
    await this.cdp.init();
    await this.wdio.setViewport(this.viewport);
    if (this.options.cookies && this.options.cookies.length > 0) await this.addCookies(this.options.cookies);
  }

  // WebDriver sets cookies only for the page's own origin, so a new session visits the server first.
  async addCookies(cookies: Cookie[]) {
    const base = new URL(this.options.baseURL);
    const here = await this.wdio.getUrl();
    if (!here.startsWith(base.origin)) await this.wdio.url(new URL('/api/v1/health', base).href);
    const domain = base.hostname;
    await this.wdio.setCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain, path: '/' })));
  }

  // One page per context: a second page in the same cookie jar has never been needed by a spec.
  newPage(): Promise<Page> {
    return Promise.resolve(this.page);
  }

  async cookies(): Promise<BrowserCookie[]> {
    const all = await this.wdio.getCookies();
    return all.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? '',
      path: c.path ?? '/',
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: c.sameSite,
      expires: c.expiry,
    }));
  }

  /** A REST client on this session's cookies: what it sets, the browser keeps, as Playwright's did. */
  get request(): Pick<Http, 'get' | 'post' | 'put' | 'patch' | 'delete' | 'fetch'> {
    const call = async (method: string, url: string, options?: RequestOptions) => {
      const before = await this.cookies();
      const http = new Http({ baseURL: this.options.baseURL, cookies: before });
      const response = await http.fetch(url, { ...options, method });
      const changed = http.cookies().filter((c) => !before.some((b) => b.name === c.name && b.value === c.value));
      if (changed.length > 0) await this.addCookies(changed);
      return response;
    };
    return {
      get: (url, o) => call('GET', url, o),
      post: (url, o) => call('POST', url, o),
      put: (url, o) => call('PUT', url, o),
      patch: (url, o) => call('PATCH', url, o),
      delete: (url, o) => call('DELETE', url, o),
      fetch: (url, o) => call(o?.method ?? 'GET', url, o),
    };
  }

  async grantPermissions(permissions: string[]) {
    for (const name of permissions) {
      await this.wdio.setPermissions({ name }, 'granted');
    }
  }

  async close() {
    await this.wdio.deleteSession().catch(() => undefined);
  }
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  modifiers?: string[];
  position?: { x: number; y: number };
  force?: boolean;
  delay?: number;
  timeout?: number;
}


export class Page {
  readonly keyboard: Keyboard;
  readonly mouse: Mouse;

  constructor(private readonly ctx: BrowserContext) {
    this.mouse = new Mouse(ctx.wdio, ctx.cdp);
    this.keyboard = new Keyboard(ctx.wdio);
  }

  get wdio() {
    return this.ctx.wdio;
  }

  get request() {
    return this.ctx.request;
  }

  private subscribed: Promise<unknown> = Promise.resolve();

  // Network events over WebDriver BiDi; a navigation waits for the subscription first.
  on(event: 'request', handler: (request: NetRequest) => void): void;
  on(event: 'response', handler: (response: NetResponse) => void): void;
  on(event: 'request' | 'response', handler: ((request: NetRequest) => void) | ((response: NetResponse) => void)) {
    const name = event === 'request' ? 'network.beforeRequestSent' : 'network.responseCompleted';
    this.subscribed = this.subscribed.then(() => this.wdio.sessionSubscribe({ events: [name] }));
    this.wdio.on(name, (params: BidiNetworkEvent) => {
      const request: NetRequest = { method: () => params.request.method, url: () => params.request.url };
      if (event === 'request') (handler as (r: NetRequest) => void)(request);
      if (event === 'response' && params.response) {
        const status = params.response.status;
        const url = params.response.url;
        (handler as (r: NetResponse) => void)({ status: () => status, url: () => url, request: () => request });
      }
    });
  }

  context() {
    return this.ctx;
  }

  // Runs `fn` in the page with window.__e2e present, injecting the bundle after a navigation drops it.
  // `fn` may be source text: the page's CSP forbids eval, but a WebDriver script is compiled outside it.
  async run<T>(fn: ((...args: never[]) => T | Promise<T>) | string, ...args: unknown[]): Promise<T> {
    const missing = '__e2e-missing__';
    const src = typeof fn === 'string' ? fn : fn.toString();
    const wrapper = `const fn = ${src}; if (!window.__e2e) return ${JSON.stringify(missing)}; return fn(...arguments);`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = (await this.wdio.execute(wrapper, ...args)) as T | string;
      if (result !== missing) return result as T;
      await this.wdio.execute(inPageSource());
    }
    throw new Error('could not load the e2e helpers into the page');
  }

  async goto(path: string) {
    await this.subscribed;
    await this.wdio.url(new URL(path, this.ctx.options.baseURL).href);
    return null;
  }

  async reload() {
    await this.wdio.refresh();
  }

  async goBack() {
    await this.wdio.back();
  }

  async goForward() {
    await this.wdio.forward();
  }

  url(): Promise<string> {
    return this.wdio.getUrl();
  }

  title(): Promise<string> {
    return this.wdio.getTitle();
  }

  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    return this.run<R>(fn.toString(), arg);
  }

  waitForTimeout(ms: number) {
    return sleep(ms);
  }

  viewportSize() {
    return this.ctx.viewport;
  }

  async setViewportSize(size: { width: number; height: number }) {
    await this.wdio.setViewport(size);
    this.ctx.viewport = size;
  }

  async close() {
    await this.ctx.close();
  }

  locator(selector: string, options?: FilterOptions) {
    const locator = new Locator(this, [{ kind: 'css', selector }]);
    return options ? locator.filter(options) : locator;
  }

  getByRole(role: string, options?: Omit<RoleOptions, 'name'> & { name?: string | RegExp }) {
    return new Locator(this, [roleStep(role, options)]);
  }

  getByText(text: string | RegExp, options?: { exact?: boolean }) {
    return new Locator(this, [{ kind: 'text', text: matcher(text), exact: options?.exact }]);
  }

  getByLabel(text: string | RegExp, options?: { exact?: boolean }) {
    return new Locator(this, [{ kind: 'label', text: matcher(text), exact: options?.exact }]);
  }

  getByTestId(id: string) {
    return new Locator(this, [{ kind: 'attr', attr: 'data-testid', value: matcher(id), exact: true }]);
  }

  getByTitle(text: string | RegExp, options?: { exact?: boolean }) {
    return new Locator(this, [{ kind: 'attr', attr: 'title', value: matcher(text), exact: options?.exact }]);
  }

  // Clicks at viewport coordinates, as a user's mouse would, holding any modifier keys.
  async clickAt(x: number, y: number, options: ClickOptions = {}) {
    const held = this.mouse.modifiers;
    this.mouse.modifiers = held | modifierBits(options.modifiers ?? []);
    try {
      await this.mouse.click(x, y, options);
    } finally {
      this.mouse.modifiers = held;
    }
  }
}

function roleStep(role: string, options?: Omit<RoleOptions, 'name'> & { name?: string | RegExp }): Step {
  const { name, ...rest } = options ?? {};
  return { kind: 'role', role, options: { ...rest, ...(name === undefined ? {} : { name: matcher(name) }) } };
}

// Two frames after an input, so the page has handled it (selectionchange included) before the
// next one, as Playwright's acknowledged input did. A navigation in between ends the wait early.
async function settle(wdio: WdioBrowser) {
  await wdio
    .execute(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))
    .catch(() => undefined);
}

export class Keyboard {
  constructor(private readonly wdio: WdioBrowser) {}

  private key() {
    return this.wdio.action('key', { id: 'keyboard' });
  }

  async press(spec: string, options: { delay?: number } = {}) {
    const keys = combo(spec);
    const action = this.key();
    for (const k of keys) action.down(k);
    if (options.delay) action.pause(options.delay);
    for (const k of [...keys].reverse()) action.up(k);
    await action.perform(true);
    await settle(this.wdio);
  }

  // One key at a time, each handled before the next, as Playwright types.
  async type(text: string, options: { delay?: number } = {}) {
    for (const ch of text) {
      const k = ch === '\n' ? keyValue('Enter') : ch;
      await this.key().down(k).up(k).perform(true);
      await settle(this.wdio);
      if (options.delay) await sleep(options.delay);
    }
  }

  // Playwright's insertText: one input event with the text, no key events.
  async insertText(text: string) {
    await this.wdio.sendCommandAndGetResult('Input.insertText', { text });
    await settle(this.wdio);
  }
}

// CDP mouse input, as Playwright sends it in Chromium: WebDriver's pointer actions, split across calls,
// never start a text selection or a drag. A native drag is intercepted and replayed as drag events,
// again as Playwright does, since headless Chromium stops sending dragover after the first one.
const CDP_BUTTON = { left: 'left', middle: 'middle', right: 'right' } as const;
const BUTTON_BIT = { left: 1, right: 2, middle: 4 } as const;
const MODIFIER_BIT: Record<string, number> = { Alt: 1, Control: 2, ControlOrMeta: 2, Meta: 4, Shift: 8 };

export class Mouse {
  private x = 0;
  private y = 0;
  private pressed: keyof typeof BUTTON_BIT | null = null;
  private dragEntered = false;
  modifiers = 0;

  constructor(
    private readonly wdio: WdioBrowser,
    private readonly cdp: Cdp,
  ) {}

  private send(type: string, extra: Record<string, unknown> = {}) {
    return this.cdp.send('Input.dispatchMouseEvent', {
      type,
      x: this.x,
      y: this.y,
      modifiers: this.modifiers,
      button: this.pressed ? CDP_BUTTON[this.pressed] : 'none',
      buttons: this.pressed ? BUTTON_BIT[this.pressed] : 0,
      ...extra,
    });
  }

  private dragEvent(type: 'dragEnter' | 'dragOver' | 'drop', data: DragData) {
    return this.cdp.send('Input.dispatchDragEvent', { type, x: this.x, y: this.y, data, modifiers: this.modifiers });
  }

  private async step() {
    const data = this.cdp.drag;
    if (data) {
      await this.dragEvent(this.dragEntered ? 'dragOver' : 'dragEnter', data);
      if (!this.dragEntered) await this.dragEvent('dragOver', data);
      this.dragEntered = true;
      return;
    }
    await this.send('mouseMoved');
    if (!this.pressed) return;
    // A move with a button down may have started a drag; the intercept lands within two frames,
    // and the drag then enters wherever the pointer already is.
    await settle(this.wdio);
    const started = this.cdp.drag;
    if (started) {
      await this.dragEvent('dragEnter', started);
      await this.dragEvent('dragOver', started);
      this.dragEntered = true;
    }
  }

  async move(x: number, y: number, options: { steps?: number } = {}) {
    const steps = Math.max(1, options.steps ?? 1);
    const fromX = this.x;
    const fromY = this.y;
    for (let i = 1; i <= steps; i++) {
      this.x = fromX + ((x - fromX) * i) / steps;
      this.y = fromY + ((y - fromY) * i) / steps;
      await this.step();
    }
    await settle(this.wdio);
  }

  async down(options: { button?: keyof typeof BUTTON_BIT; clickCount?: number } = {}) {
    this.cdp.drag = null;
    this.dragEntered = false;
    await this.cdp.send('Input.setInterceptDrags', { enabled: true });
    this.pressed = options.button ?? 'left';
    await this.send('mousePressed', { clickCount: options.clickCount ?? 1 });
    await settle(this.wdio);
  }

  async up(options: { button?: keyof typeof BUTTON_BIT; clickCount?: number } = {}) {
    const button = options.button ?? 'left';
    const data = this.cdp.drag;
    if (data) {
      if (!this.dragEntered) {
        await this.dragEvent('dragEnter', data);
        await this.dragEvent('dragOver', data);
      }
      await this.dragEvent('drop', data);
      this.cdp.drag = null;
      this.dragEntered = false;
    }
    this.pressed = null;
    await this.send('mouseReleased', { button: CDP_BUTTON[button], clickCount: options.clickCount ?? 1 });
    await settle(this.wdio);
  }

  async click(x: number, y: number, options: ClickOptions = {}) {
    const button = options.button ?? 'left';
    await this.move(x, y);
    for (let i = 1; i <= (options.clickCount ?? 1); i++) {
      this.pressed = button;
      await this.send('mousePressed', { clickCount: i });
      if (options.delay) await sleep(options.delay);
      this.pressed = null;
      await this.send('mouseReleased', { button: CDP_BUTTON[button], clickCount: i });
    }
    await settle(this.wdio);
  }

  dblclick(x: number, y: number) {
    return this.click(x, y, { clickCount: 2 });
  }

}

export function modifierBits(names: string[]): number {
  return names.reduce((bits, name) => bits | (MODIFIER_BIT[name] ?? 0), 0);
}

export interface NetRequest {
  method(): string;
  url(): string;
}

export interface NetResponse {
  status(): number;
  url(): string;
  request(): NetRequest;
}

interface BidiNetworkEvent {
  request: { method: string; url: string };
  response?: { status: number; url: string };
}

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Target {
  ok: boolean;
  reason?: string;
  x: number;
  y: number;
}

export interface FilterOptions {
  hasText?: string | RegExp;
  has?: Locator;
}

export class Locator {
  constructor(
    private readonly owner: Page,
    readonly steps: Step[],
  ) {}

  page(): Page {
    return this.owner;
  }

  private with(step: Step) {
    return new Locator(this.owner, [...this.steps, step]);
  }

  toString() {
    return `locator(${JSON.stringify(this.steps)})`;
  }

  locator(selector: string | Locator, options?: FilterOptions) {
    const inner = typeof selector === 'string' ? this.with({ kind: 'css', selector }) : new Locator(this.owner, [...this.steps, ...selector.steps]);
    return options ? inner.filter(options) : inner;
  }

  getByRole(role: string, options?: Omit<RoleOptions, 'name'> & { name?: string | RegExp }) {
    return this.with(roleStep(role, options));
  }

  getByText(text: string | RegExp, options?: { exact?: boolean }) {
    return this.with({ kind: 'text', text: matcher(text), exact: options?.exact });
  }

  getByLabel(text: string | RegExp, options?: { exact?: boolean }) {
    return this.with({ kind: 'label', text: matcher(text), exact: options?.exact });
  }

  getByTestId(id: string) {
    return this.with({ kind: 'attr', attr: 'data-testid', value: matcher(id), exact: true });
  }

  getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }) {
    return this.with({ kind: 'attr', attr: 'placeholder', value: matcher(text), exact: options?.exact });
  }

  filter(options: FilterOptions) {
    return this.with({
      kind: 'filter',
      ...(options.hasText === undefined ? {} : { hasText: matcher(options.hasText) }),
      ...(options.has ? { has: options.has.steps } : {}),
    });
  }

  nth(index: number) {
    return this.with({ kind: 'nth', index });
  }

  first() {
    return this.nth(0);
  }

  last() {
    return this.nth(-1);
  }

  // Every match, as WebDriver element references.
  async refs(): Promise<Ref[]> {
    return this.owner.run<Ref[]>('(steps) => window.__e2e.resolve(steps)', this.steps);
  }

  async count(): Promise<number> {
    return (await this.refs()).length;
  }

  // Waits until the locator resolves to exactly one element, then runs `fn` on it in the page.
  async one<T>(fn: (el: Element, arg: never) => T | Promise<T>, arg?: unknown, timeout = ACTION_TIMEOUT): Promise<T> {
    const deadline = Date.now() + timeout;
    let last = 'no element matches';
    for (;;) {
      try {
        const out = await this.owner.run<{ count: number; found: string[]; value?: unknown }>(
          `async (steps, a) => {
            const els = window.__e2e.resolve(steps);
            if (els.length !== 1) return { count: els.length, found: window.__e2e.describeAll(steps) };
            const f = (${fn.toString()});
            return { count: 1, found: [], value: await f(els[0], a) };
          }`,
          this.steps,
          arg,
        );
        if (out.count === 1) return out.value as T;
        last = out.count === 0 ? 'no element matches' : `strict mode: ${out.count} elements match (${out.found.join(', ')})`;
      } catch (err) {
        last = String(err);
      }
      if (Date.now() > deadline) throw new Error(`${this.toString()}: ${last}`);
      await sleep(POLL_MS);
    }
  }

  private async act(action: (t: Target) => Promise<void>, options: ClickOptions & { needEnabled?: boolean } = {}) {
    const deadline = Date.now() + (options.timeout ?? ACTION_TIMEOUT);
    let last = '';
    for (;;) {
      const t = await this.one(
        (el, a: { position?: { x: number; y: number }; needEnabled: boolean; force: boolean }) =>
          window.__e2e.target(el, a.position, a.needEnabled, a.force),
        { position: options.position, needEnabled: options.needEnabled ?? true, force: options.force ?? false },
        Math.max(1, deadline - Date.now()),
      );
      if (t.ok) return action(t);
      last = t.reason ?? '';
      if (Date.now() > deadline) throw new Error(`${this.toString()}: ${last}`);
      await sleep(POLL_MS);
    }
  }

  // A click that another element took (see arm() in in-page.ts) never reached the page, so it is retried.
  async click(options: ClickOptions = {}) {
    const deadline = Date.now() + (options.timeout ?? ACTION_TIMEOUT);
    for (;;) {
      let hit: boolean | null = null;
      await this.act(async (t) => {
        await this.one((el) => window.__e2e.arm(el));
        try {
          await this.owner.clickAt(t.x, t.y, options);
        } finally {
          hit = await this.owner.run<boolean | null>('() => window.__e2e.disarm()').catch(() => null);
        }
      }, { ...options, timeout: Math.max(1, deadline - Date.now()) });
      if (hit !== false || options.force) return;
      if (Date.now() > deadline) throw new Error(`${this.toString()}: another element kept taking the click`);
      await sleep(POLL_MS);
    }
  }

  dblclick(options: ClickOptions = {}) {
    return this.click({ ...options, clickCount: 2 });
  }

  hover(options: ClickOptions = {}) {
    return this.act((t) => this.owner.mouse.move(t.x, t.y), { ...options, needEnabled: false });
  }

  async focus() {
    await this.one((el) => (el as HTMLElement).focus());
  }

  async fill(value: string) {
    const deadline = Date.now() + ACTION_TIMEOUT;
    for (;;) {
      const err = await this.one((el) => window.__e2e.selectAll(el));
      if (err === null) break;
      if (Date.now() > deadline) throw new Error(`${this.toString()}: ${err}`);
      await sleep(POLL_MS);
    }
    if (value === '') await this.owner.keyboard.press('Delete');
    if (value !== '') await this.owner.keyboard.insertText(value);
  }

  async press(key: string) {
    await this.focus();
    await this.owner.keyboard.press(key);
  }

  async pressSequentially(text: string, options: { delay?: number } = {}) {
    await this.focus();
    await this.owner.keyboard.type(text, options);
  }

  async selectOption(value: string | { label?: string; value?: string }) {
    const wanted = typeof value === 'string' ? { either: value } : value;
    const picked = await this.one((el, w: { either?: string; label?: string; value?: string }) => {
      const select = el as HTMLSelectElement;
      const option = [...select.options].find(
        (o) => o.value === (w.value ?? w.either) || o.label === (w.label ?? w.either) || o.textContent?.trim() === (w.label ?? w.either),
      );
      if (!option) return null;
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return option.value;
    }, wanted);
    if (picked === null) throw new Error(`${this.toString()}: no option ${JSON.stringify(value)}`);
    return [picked];
  }

  async check() {
    const checked = await this.one((el) => (el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true');
    if (!checked) await this.click();
  }

  async dragTo(target: Locator) {
    const from = await this.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error(`${this.toString()}: drag source or target is not visible`);
    const mouse = this.owner.mouse;
    await mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await mouse.down();
    await mouse.move(to.x + to.width / 2, to.y + to.height / 2);
    await mouse.up();
  }

  // WebDriver uploads by path, so a payload goes through a temporary file named as the spec asked.
  async setInputFiles(files: string | FilePayload | (string | FilePayload)[]) {
    const list = Array.isArray(files) ? files : [files];
    const paths: string[] = [];
    for (const f of list) {
      if (typeof f === 'string') paths.push(f);
      if (typeof f !== 'string') {
        const dir = await mkdtemp(join(tmpdir(), 'e2e-upload-'));
        const path = join(dir, f.name);
        await writeFile(path, f.buffer);
        paths.push(path);
      }
    }
    const deadline = Date.now() + ACTION_TIMEOUT;
    for (;;) {
      const refs = await this.refs();
      if (refs.length === 1 && refs[0]) {
        const input = await this.owner.wdio.$(refs[0] as never);
        await input.addValue(paths.join('\n'));
        return;
      }
      if (Date.now() > deadline) throw new Error(`${this.toString()}: ${String(refs.length)} file inputs match`);
      await sleep(POLL_MS);
    }
  }

  boundingBox(): Promise<Box | null> {
    return this.one((el) => window.__e2e.box(el));
  }

  textContent(): Promise<string | null> {
    return this.one((el) => el.textContent);
  }

  getAttribute(name: string): Promise<string | null> {
    return this.one((el, n: string) => el.getAttribute(n), name);
  }

  allInnerTexts(): Promise<string[]> {
    return this.owner.run((steps: Step[]) => window.__e2e.resolve(steps).map((el) => (el as HTMLElement).innerText), this.steps);
  }

  evaluate<R, A, E extends Element = HTMLElement>(fn: (el: E, arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    return this.one(fn as unknown as (el: Element, arg: never) => R, arg);
  }

  async evaluateAll<R, A, E extends Element = HTMLElement>(fn: (els: E[], arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    return this.owner.run<R>(`(steps, a) => (${fn.toString()})(window.__e2e.resolve(steps), a)`, this.steps, arg);
  }

}

interface InPage {
  resolve(steps: Step[], scope?: ParentNode): Element[];
  isVisible(el: Element): boolean;
  isEnabled(el: Element): boolean;
  isEditable(el: Element): boolean;
  target(el: Element, position: { x: number; y: number } | undefined, needEnabled: boolean, force: boolean): Promise<Target>;
  selectAll(el: Element): string | null;
  box(el: Element): Box | null;
  inViewport(el: Element): boolean;
  describeAll(steps: Step[]): string[];
  arm(el: Element): void;
  disarm(): boolean | null;
}

declare global {
  interface Window {
    __e2e: InPage;
  }
}
