// A REST client over fetch, with a cookie jar. It answers the calls the specs and ApiClient make.
export interface Cookie {
  name: string;
  value: string;
}

export interface RequestOptions {
  data?: unknown;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
}

export class HttpResponse {
  constructor(
    private readonly response: Response,
    private readonly bytes: Buffer,
  ) {}

  ok(): boolean {
    return this.response.ok;
  }

  status(): number {
    return this.response.status;
  }

  url(): string {
    return this.response.url;
  }

  headers(): Record<string, string> {
    return Object.fromEntries(this.response.headers.entries());
  }

  body(): Buffer {
    return this.bytes;
  }

  text(): Promise<string> {
    return Promise.resolve(this.bytes.toString('utf8'));
  }

  json(): Promise<unknown> {
    return Promise.resolve(JSON.parse(this.bytes.toString('utf8')));
  }
}

export interface HttpOptions {
  baseURL: string;
  cookies?: Cookie[];
  extraHTTPHeaders?: Record<string, string>;
}

export class Http {
  private readonly jar = new Map<string, string>();

  constructor(private readonly options: HttpOptions) {
    for (const c of options.cookies ?? []) this.jar.set(c.name, c.value);
  }

  get(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: 'GET' });
  }

  post(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: 'POST' });
  }

  put(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: 'PUT' });
  }

  patch(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: 'PATCH' });
  }

  delete(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: 'DELETE' });
  }

  async fetch(url: string, options: RequestOptions & { method?: string } = {}): Promise<HttpResponse> {
    const target = new URL(url, this.options.baseURL);
    for (const [k, v] of Object.entries(options.params ?? {})) target.searchParams.set(k, String(v));
    const headers = new Headers({ ...this.options.extraHTTPHeaders, ...options.headers });
    if (this.jar.size > 0) headers.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const response = await fetch(target, { method: options.method ?? 'GET', headers, body: body(options, headers) });
    for (const line of response.headers.getSetCookie()) this.remember(line);
    return new HttpResponse(response, Buffer.from(await response.arrayBuffer()));
  }

  cookies(): Cookie[] {
    return [...this.jar].map(([name, value]) => ({ name, value }));
  }

  dispose(): Promise<void> {
    this.jar.clear();
    return Promise.resolve();
  }

  private remember(line: string) {
    const [pair = '', ...attrs] = line.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
    if (expired) this.jar.delete(name);
    if (!expired) this.jar.set(name, value);
  }
}

function body(options: RequestOptions, headers: Headers): BodyInit | undefined {
  if (options.multipart) {
    const form = new FormData();
    for (const [k, v] of Object.entries(options.multipart)) {
      if (typeof v === 'string') form.append(k, v);
      if (typeof v !== 'string') form.append(k, new Blob([new Uint8Array(v.buffer)], { type: v.mimeType }), v.name);
    }
    return form;
  }
  if (options.data === undefined) return undefined;
  if (typeof options.data === 'string' || Buffer.isBuffer(options.data)) return options.data as BodyInit;
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return JSON.stringify(options.data);
}
