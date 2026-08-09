import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GitdocsClient, createGitdocsMcpServer, type FetchLike } from '@gitdocs/mcp';
import { MCP_ENDPOINT, type Agent } from '@gitdocs/shared';

/** Verbs the loopback client uses. Anything else never reaches app.inject(). */
type LoopbackMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const LOOPBACK_METHODS: LoopbackMethod[] = ['GET', 'POST', 'PATCH', 'DELETE'];

function loopbackMethod(value: string | undefined): LoopbackMethod {
  const upper = (value ?? 'GET').toUpperCase();
  const found = LOOPBACK_METHODS.find((method) => method === upper);
  if (found === undefined) throw new Error(`The MCP server does not use ${upper}`);
  return found;
}

/** The address this request arrived on, so nothing has to be configured. */
function originOf(request: FastifyRequest): string {
  const host = request.headers.host ?? 'localhost';
  return `${request.protocol}://${host}`;
}

/**
 * The credential the caller sent, forwarded verbatim to every loopback request.
 * The MCP tools therefore run as whoever is connected: the auth hook resolves the same
 * principal it resolved for this request, and an agent gets no authority it did not have.
 */
function credentialsOf(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = request.headers.authorization;
  if (typeof auth === 'string') headers.authorization = auth;
  const cookie = request.headers.cookie;
  if (typeof cookie === 'string') headers.cookie = cookie;
  return headers;
}

function headerRecord(init: RequestInit['headers']): Record<string, string> {
  if (init === undefined) return {};
  return Object.fromEntries(new Headers(init).entries());
}

/**
 * A `fetch` that answers from this very Fastify instance instead of opening a socket.
 * The MCP tools reuse the REST layer, so indexing, validation and git commits behave exactly
 * as they do for the web editor, without the server having to reach its own port.
 */
export function loopbackFetch(app: FastifyInstance, credentials: Record<string, string>): FetchLike {
  return async (input, init = {}) => {
    const url = new URL(input);
    const body = typeof init.body === 'string' ? init.body : undefined;
    const response = await app.inject({
      method: loopbackMethod(init.method),
      url: `${url.pathname}${url.search}`,
      headers: { ...headerRecord(init.headers), ...credentials },
      ...(body === undefined ? {} : { payload: body }),
    });
    return new Response(response.body, { status: response.statusCode });
  };
}

/** The brief an agent reads about itself before it calls a tool. */
export function agentBrief(agent: Agent): string {
  const who = `You are connected to gitdocs as "${agent.name}" (@${agent.handle}).`;
  if (agent.identity.length === 0) return who;
  return `${who}\n\nThe people who run this site describe you like this:\n${agent.identity}`;
}

function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  return new Request(`${originOf(request)}${request.url}`, { method: request.method, headers });
}

/**
 * The remote MCP endpoint.
 *
 * It is stateless on purpose: an agent token identifies the caller on every single request, so
 * there is no session to keep, nothing to expire and nothing to lose when the process restarts.
 * A fresh MCP server is built per request and closed again once the answer is written.
 */
export function registerMcpRoutes(app: FastifyInstance): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    // A stateless server has no stream to push on, so the GET half of the transport is unused.
    if (request.method === 'GET') {
      return reply.status(405).send({
        error: { code: 'VALIDATION', message: `Use POST ${MCP_ENDPOINT} to talk to this server.` },
      });
    }

    const client = new GitdocsClient({
      baseUrl: originOf(request),
      fetch: loopbackFetch(app, credentialsOf(request)),
    });
    const agent = request.principal.agent;
    const server = createGitdocsMcpServer({
      client,
      ...(agent === null ? {} : { identity: agentBrief(agent) }),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const answer = await transport.handleRequest(toWebRequest(request), {
        parsedBody: request.body,
      });
      const text = await answer.text();
      const type = answer.headers.get('content-type');
      reply.status(answer.status);
      if (type !== null) reply.header('content-type', type);
      return reply.send(text.length === 0 ? undefined : text);
    } catch (err) {
      request.log.error({ err }, 'the MCP request failed');
      throw err;
    } finally {
      await server.close();
    }
  };

  app.route({ method: ['GET', 'POST', 'DELETE'], url: MCP_ENDPOINT, handler });
}
