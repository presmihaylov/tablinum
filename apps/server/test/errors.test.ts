import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBodySchema, gitError, type PageSummary } from '@gitdocs/shared';
import { toErrorResponse } from '../src/errors.js';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

function headers(): Record<string, string> {
  return harness.authHeaders();
}

interface InjectInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  payload?: string | Record<string, unknown>;
}

async function errorOf(url: string, init: InjectInit = {}) {
  const response = await harness.app.inject({
    method: init.method ?? 'GET',
    url,
    headers: init.headers ?? headers(),
    payload: init.payload,
  });
  return { status: response.statusCode, body: bodyOf(response, ErrorBodySchema) };
}

describe('error envelope', () => {
  it('returns NOT_FOUND for an unknown page id', async () => {
    const result = await errorOf('/api/v1/pages/pg_00000000000000000000000000');
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('NOT_FOUND');
    expect(result.body.error.message.length).toBeGreaterThan(0);
  });

  it('returns NOT_FOUND for an unknown route', async () => {
    const result = await errorOf('/api/v1/does-not-exist');
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('NOT_FOUND');
  });

  it('returns CONFLICT when a page path is taken', async () => {
    await seed(harness);
    const result = await errorOf('/api/v1/pages', {
      method: 'POST',
      payload: { path: 'eng/deploy', title: 'Duplicate' },
    });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('CONFLICT');
  });

  it('returns VALIDATION for a bad body', async () => {
    const result = await errorOf('/api/v1/pages', {
      method: 'POST',
      payload: { path: 'eng/deploy' },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION');
    expect(result.body.error.message).toContain('title');
  });

  it('returns VALIDATION for malformed JSON', async () => {
    const result = await errorOf('/api/v1/pages', {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: '{"path": ',
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION');
  });

  it('returns VALIDATION for an unsupported content type', async () => {
    const result = await errorOf('/api/v1/pages', {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'text/plain' },
      payload: 'not json',
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION');
  });

  it('returns UNAUTHORIZED without a credential', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/tree' });
    expect(response.statusCode).toBe(401);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');
  });

  it('returns GIT_ERROR when the repository fails', async () => {
    harness.git.commit = async () => {
      throw gitError('index.lock exists');
    };
    const result = await errorOf('/api/v1/git/commit', { method: 'POST' });
    expect(result.status).toBe(502);
    expect(result.body.error.code).toBe('GIT_ERROR');
  });

  it('returns INTERNAL and hides the cause for an unexpected failure', async () => {
    harness.store.listPages = async (): Promise<PageSummary[]> => {
      throw new Error('secret database path /var/private/leak');
    };
    const result = await errorOf('/api/v1/pages');
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL');
    expect(result.body.error.message).toBe('Internal error');
    expect(JSON.stringify(result.body)).not.toContain('secret database path');
  });
});

describe('toErrorResponse', () => {
  it('keeps the status of an AppError', () => {
    const result = toErrorResponse(gitError('detached head'));
    expect(result).toEqual({
      status: 502,
      body: { error: { code: 'GIT_ERROR', message: 'detached head' } },
    });
  });

  it('falls back to INTERNAL for a non-error value', () => {
    expect(toErrorResponse('boom')).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Internal error' } },
    });
  });
});
