import {
  contentRev,
  newPageId,
  type Account,
  type Agent,
  type CommentThread,
  type GitStatus,
  type Page,
  type PageSummary,
  type Revision,
  type SearchHit,
  type Space,
  type TreeNode,
} from '@tablinum/shared';
import type { FetchLike, SpaceTree } from '../src/client.js';

// ---------------------------------------------------------------------------
// mocked fetch
// ---------------------------------------------------------------------------

export interface RecordedCall {
  method: string;
  url: string;
  pathname: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export interface MockReply {
  __mockReply: true;
  status: number;
  json?: unknown;
  text?: string;
}

export type RouteResult = MockReply | unknown;
export type Route = RouteResult | ((call: RecordedCall) => RouteResult);
export type Routes = Record<string, Route>;

/** Reply with a JSON body and an explicit status. */
export function reply(status: number, json?: unknown): MockReply {
  return { __mockReply: true, status, json };
}

/** Reply with a raw (non JSON) body, for error-mapping tests. */
export function replyText(status: number, text: string): MockReply {
  return { __mockReply: true, status, text };
}

/** Reject the request the way a dead server does. */
export function networkError(message = 'fetch failed'): MockReply {
  return { __mockReply: true, status: -1, text: message };
}

function isMockReply(value: unknown): value is MockReply {
  return typeof value === 'object' && value !== null && '__mockReply' in value;
}

export interface MockFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
  /** All calls matching "METHOD /path". */
  matching(key: string): RecordedCall[];
  last(): RecordedCall;
}

/**
 * Build a fetch double. Route keys are "METHOD /pathname" and ignore the query string;
 * a route value is either the JSON body (status 200) or a `reply(...)`/handler.
 */
export function mockFetch(routes: Routes): MockFetch {
  const calls: RecordedCall[] = [];

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    const headers: Record<string, string> = {};
    for (const [key, value] of new Headers(init?.headers).entries()) {
      headers[key.toLowerCase()] = value;
    }
    const call: RecordedCall = {
      method,
      url: input,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
      headers,
    };
    calls.push(call);

    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) {
      throw new Error(`mockFetch: no route for ${key}. Known routes: ${Object.keys(routes).join(', ')}`);
    }
    const route = routes[key];
    const outcome = typeof route === 'function' ? (route as (c: RecordedCall) => RouteResult)(call) : route;

    if (isMockReply(outcome)) {
      if (outcome.status === -1) throw new TypeError(outcome.text ?? 'fetch failed');
      if (outcome.text !== undefined) {
        return new Response(outcome.text, {
          status: outcome.status,
          headers: { 'content-type': 'text/plain' },
        });
      }
      return new Response(JSON.stringify(outcome.json ?? {}), {
        status: outcome.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(outcome), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    fetch: fetchImpl,
    calls,
    matching: (key) => calls.filter((call) => `${call.method} ${call.pathname}` === key),
    last: () => {
      const call = calls[calls.length - 1];
      if (call === undefined) throw new Error('mockFetch: no call was made');
      return call;
    },
  };
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

export function makePage(overrides: Partial<Page> = {}): Page {
  const path = overrides.path ?? 'eng/deploy';
  const space = path.split('/')[0] ?? 'eng';
  return {
    id: newPageId(),
    path,
    space,
    title: 'Deploy runbook',
    created: '2026-08-01T09:00:00.000Z',
    updated: '2026-08-08T10:00:00.000Z',
    markdown: 'The deploy runbook body.\n',
    rev: contentRev('The deploy runbook body.\n'),
    filePath: `/content/${path}.md`,
    hasChildren: false,
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<Page> = {}): PageSummary {
  const { markdown: _markdown, rev: _rev, ...summary } = makePage(overrides);
  return summary;
}

export function makeSpace(overrides: Partial<Space> = {}): Space {
  return { slug: 'eng', name: 'Engineering', ...overrides };
}

export function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: newPageId(),
    path: 'eng/deploy',
    title: 'Deploy runbook',
    children: [],
    ...overrides,
  };
}

export function makeSpaceTree(overrides: Partial<SpaceTree> = {}): SpaceTree {
  return { ...makeSpace(), tree: [], ...overrides };
}

export function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: newPageId(),
    path: 'eng/deploy',
    title: 'Deploy runbook',
    snippet: 'How to deploy the service.',
    score: 4.5,
    ...overrides,
  };
}

export function makeRevision(overrides: Partial<Revision> = {}): Revision {
  return {
    sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    author: 'ana',
    email: 'ana@example.com',
    date: '2026-08-08T10:00:00.000Z',
    message: 'Update the deploy runbook',
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'us_01J8XYZABCDEFGHJKMNPQRSTVW',
    email: 'ana@example.com',
    name: 'Ana Ruiz',
    handle: 'ana.ruiz',
    role: 'member',
    color: '#3b82f6',
    avatarRev: null,
    disabled: false,
    created: '2026-08-01T09:00:00.000Z',
    updated: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'ag_01J8XYZABCDEFGHJKMNPQRSTVW',
    name: 'Doc Bot',
    handle: 'doc.bot',
    identity: 'Keeps the runbooks tidy.',
    workspaceId: 'ws_01J8XYZABCDEFGHJKMNPQRSTVW',
    color: '#a855f7',
    avatarRev: null,
    created: '2026-08-01T09:00:00.000Z',
    updated: '2026-08-01T09:00:00.000Z',
    lastUsed: null,
    ...overrides,
  };
}

export function makeThread(overrides: Partial<CommentThread> = {}): CommentThread {
  const id = overrides.id ?? 'ct_01J8XYZABCDEFGHJKMNPQRSTVW';
  return {
    id,
    pageId: newPageId(),
    anchor: { quote: 'the deploy runbook', prefix: 'The ', suffix: ' body.', start: 4 },
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    created: '2026-08-08T10:00:00.000Z',
    updated: '2026-08-08T10:00:00.000Z',
    comments: [
      {
        id: 'cm_01J8XYZABCDEFGHJKMNPQRSTVW',
        threadId: id,
        author: 'us_01J8XYZABCDEFGHJKMNPQRSTVW',
        body: 'Is this still the right order?',
        created: '2026-08-08T10:00:00.000Z',
        updated: '2026-08-08T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function makeStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: 'main',
    ahead: 0,
    behind: 0,
    dirtyFiles: [],
    remote: 'git@example.com:acme/docs.git',
    lastCommit: makeRevision(),
    conflict: null,
    ...overrides,
  };
}
