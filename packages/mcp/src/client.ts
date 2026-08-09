import {
  AppError,
  BacklinksResponseSchema,
  DeletePageResponseSchema,
  ErrorBodySchema,
  GitCommitResponseSchema,
  GitPullResponseSchema,
  GitPushResponseSchema,
  GitStatusResponseSchema,
  HealthResponseSchema,
  HistoryResponseSchema,
  PageListResponseSchema,
  PageResponseSchema,
  RevisionContentResponseSchema,
  SearchResponseSchema,
  SpacesResponseSchema,
  TreeResponseSchema,
  type Backlink,
  type CreatePageBody,
  type ErrorCode,
  type GitPullResponse,
  type GitPushResponse,
  type GitStatus,
  type HealthResponse,
  type Page,
  type PageId,
  type PagePath,
  type PageSummary,
  type Revision,
  type RevisionContentResponse,
  type SearchHit,
  type Space,
  type TreeNode,
  type UpdatePageBody,
} from '@tablinum/shared';
import type { z } from 'zod';

/** One entry of `GET /api/v1/tree`: a space plus its page tree. */
export type SpaceTree = Space & { tree: TreeNode[] };

/** The subset of `fetch` this client uses. Tests inject their own. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TablinumClientOptions {
  /** Base URL of a running tablinum server, e.g. "http://127.0.0.1:4000". */
  baseUrl: string;
  /** Bearer token from the server's `TABLINUM_API_TOKENS`. Omit when the server runs in open mode. */
  token?: string | null;
  fetch?: FetchLike;
  /** Abort a request after this many milliseconds. 0 disables the timeout. */
  timeoutMs?: number;
}

export interface SearchParams {
  q: string;
  space?: string;
  limit?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHORIZED',
  403: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION',
  502: 'GIT_ERROR',
  504: 'GIT_ERROR',
};

type QueryValue = string | number | boolean | undefined | null;

function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  if (encoded.length === 0) return '';
  return `?${encoded}`;
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.join('.');
      return at.length === 0 ? issue.message : `${at}: ${issue.message}`;
    })
    .join('; ');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

/** Turn a non-2xx response into an AppError, preferring the server's own error envelope. */
function errorFromResponse(status: number, rawBody: string): AppError {
  const code = CODE_BY_STATUS[status] ?? 'INTERNAL';
  try {
    const parsed = ErrorBodySchema.safeParse(JSON.parse(rawBody));
    if (parsed.success) return new AppError(parsed.data.error.code, parsed.data.error.message);
  } catch {
    // Body was not JSON; fall through to the generic message below.
  }
  const detail = rawBody.trim().length === 0 ? '(empty body)' : truncate(rawBody.trim(), 300);
  return new AppError(code, `tablinum server responded ${status}: ${detail}`);
}

/**
 * Typed HTTP client for the tablinum REST API.
 *
 * Every call goes through the server so that indexing, git commits and validation stay
 * consistent with what the web editor does. Nothing here touches the filesystem.
 */
export class TablinumClient {
  readonly baseUrl: string;
  private readonly token: string | null;
  private readonly doFetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: TablinumClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    if (this.baseUrl.length === 0) {
      throw new AppError('VALIDATION', 'TABLINUM_URL must be a non-empty base URL');
    }
    this.token = options.token != null && options.token.length > 0 ? options.token : null;
    const injected = options.fetch;
    this.doFetch = injected ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private headers(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (hasBody) headers['content-type'] = 'application/json';
    if (this.token !== null) headers['authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    throw new AppError(
      'INTERNAL',
      `The tablinum server returned an unexpected ${label} response - ${issueText(result.error)}`,
    );
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer =
      this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    let response: Response;
    try {
      response = await this.doFetch(url, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AppError(
        'INTERNAL',
        `Cannot reach the tablinum server at ${this.baseUrl} (${reason}). ` +
          'Start the server, or point TABLINUM_URL at a running instance.',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const rawBody = await response.text();
    if (!response.ok) throw errorFromResponse(response.status, rawBody);

    if (rawBody.trim().length === 0) return this.parse(schema, {}, `${method} ${path}`);

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new AppError(
        'INTERNAL',
        `The tablinum server returned invalid JSON for ${method} ${path}: ${truncate(rawBody, 200)}`,
      );
    }
    return this.parse(schema, json, `${method} ${path}`);
  }

  async health(): Promise<HealthResponse> {
    return this.request('GET', '/api/v1/health', HealthResponseSchema);
  }

  async listSpaces(): Promise<Space[]> {
    const body = await this.request('GET', '/api/v1/spaces', SpacesResponseSchema);
    return body.spaces;
  }

  async tree(): Promise<SpaceTree[]> {
    const body = await this.request('GET', '/api/v1/tree', TreeResponseSchema);
    return body.spaces;
  }

  async listPages(): Promise<PageSummary[]> {
    const body = await this.request('GET', '/api/v1/pages', PageListResponseSchema);
    return body.pages;
  }

  async getPageByPath(path: PagePath): Promise<Page> {
    const body = await this.request(
      'GET',
      `/api/v1/pages${buildQuery({ path })}`,
      PageResponseSchema,
    );
    return body.page;
  }

  async getPageById(id: PageId): Promise<Page> {
    const body = await this.request(
      'GET',
      `/api/v1/pages/${encodeURIComponent(id)}`,
      PageResponseSchema,
    );
    return body.page;
  }

  async createPage(input: CreatePageBody): Promise<Page> {
    const body = await this.request('POST', '/api/v1/pages', PageResponseSchema, input);
    return body.page;
  }

  async updatePage(id: PageId, patch: UpdatePageBody): Promise<Page> {
    const body = await this.request(
      'PATCH',
      `/api/v1/pages/${encodeURIComponent(id)}`,
      PageResponseSchema,
      patch,
    );
    return body.page;
  }

  async deletePage(id: PageId, recursive: boolean): Promise<PagePath[]> {
    const query = recursive ? buildQuery({ recursive: 'true' }) : '';
    const body = await this.request(
      'DELETE',
      `/api/v1/pages/${encodeURIComponent(id)}${query}`,
      DeletePageResponseSchema,
    );
    return body.deleted;
  }

  async search(params: SearchParams): Promise<SearchHit[]> {
    const query = buildQuery({
      q: params.q,
      space: params.space,
      limit: params.limit,
    });
    const body = await this.request('GET', `/api/v1/search${query}`, SearchResponseSchema);
    return body.hits;
  }

  async backlinks(id: PageId): Promise<Backlink[]> {
    const body = await this.request(
      'GET',
      `/api/v1/pages/${encodeURIComponent(id)}/backlinks`,
      BacklinksResponseSchema,
    );
    return body.backlinks;
  }

  async history(id: PageId, limit?: number): Promise<Revision[]> {
    const body = await this.request(
      'GET',
      `/api/v1/pages/${encodeURIComponent(id)}/history${buildQuery({ limit })}`,
      HistoryResponseSchema,
    );
    return body.revisions;
  }

  async revision(id: PageId, sha: string): Promise<RevisionContentResponse> {
    return this.request(
      'GET',
      `/api/v1/pages/${encodeURIComponent(id)}/revisions/${encodeURIComponent(sha)}`,
      RevisionContentResponseSchema,
    );
  }


  async gitStatus(): Promise<GitStatus> {
    const body = await this.request('GET', '/api/v1/git/status', GitStatusResponseSchema);
    return body.status;
  }

  async gitPull(): Promise<GitPullResponse> {
    return this.request('POST', '/api/v1/git/pull', GitPullResponseSchema, {});
  }

  async gitPush(): Promise<GitPushResponse> {
    return this.request('POST', '/api/v1/git/push', GitPushResponseSchema, {});
  }

  async gitCommit(message?: string): Promise<string | null> {
    const payload = message === undefined ? {} : { message };
    const body = await this.request('POST', '/api/v1/git/commit', GitCommitResponseSchema, payload);
    return body.sha;
  }
}
