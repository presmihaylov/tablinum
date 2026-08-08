import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ErrorBodySchema,
  GitCommitResponseSchema,
  GitPullResponseSchema,
  GitPushResponseSchema,
  GitStatusResponseSchema,
  HistoryResponseSchema,
  PageResponseSchema,
  RevisionContentResponseSchema,
  gitError,
} from '@gitdocs/shared';
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

describe('git endpoints', () => {
  it('reports the branch and the dirty files', async () => {
    await seed(harness);
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/git/status',
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const { status } = bodyOf(response, GitStatusResponseSchema);
    expect(status.branch).toBe('main');
    expect(status.dirtyFiles.length).toBeGreaterThan(0);
  });

  it('commits on demand and reports a clean tree afterwards', async () => {
    await seed(harness);
    const committed = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/commit',
      headers: headers(),
      payload: { message: 'docs: seed the repo' },
    });
    expect(committed.statusCode).toBe(200);
    expect(bodyOf(committed, GitCommitResponseSchema).sha).toMatch(/^[0-9a-f]{40}$/);

    const again = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/commit',
      headers: headers(),
    });
    expect(bodyOf(again, GitCommitResponseSchema).sha).toBeNull();
  });

  it('answers pull and push without a remote', async () => {
    await seed(harness);
    const pulled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/pull',
      headers: headers(),
    });
    expect(bodyOf(pulled, GitPullResponseSchema).pulled).toBe(0);

    const pushed = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/push',
      headers: headers(),
    });
    expect(bodyOf(pushed, GitPushResponseSchema).pushed).toBe(false);
  });

  it('maps a git failure to GIT_ERROR with status 502', async () => {
    harness.git.status = async () => {
      throw gitError('remote hung up');
    };
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/git/status',
      headers: headers(),
    });
    expect(response.statusCode).toBe(502);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('GIT_ERROR');
  });
});

describe('page history', () => {
  it('lists two revisions and reads the older one back', async () => {
    await seed(harness);
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: headers(),
      payload: { path: 'eng/history', title: 'History', markdown: 'First version.' },
    });
    const page = bodyOf(created, PageResponseSchema).page;
    await harness.git.flush();

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page.id}`,
      headers: headers(),
      payload: { markdown: 'Second version.' },
    });
    await harness.git.flush();

    const history = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${page.id}/history`,
      headers: headers(),
    });
    expect(history.statusCode).toBe(200);
    const { revisions } = bodyOf(history, HistoryResponseSchema);
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    expect(revisions[0]?.email).toBe('gitdocs@localhost');

    const oldest = revisions[revisions.length - 1];
    const content = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${page.id}/revisions/${oldest?.sha}`,
      headers: headers(),
    });
    expect(content.statusCode).toBe(200);
    const revision = bodyOf(content, RevisionContentResponseSchema);
    expect(revision.markdown).toBe('First version.');
    expect(revision.frontmatter.id).toBe(page.id);
    expect(revision.frontmatter.title).toBe('History');
  });

  it('honours the limit query parameter', async () => {
    await seed(harness);
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: headers(),
      payload: { path: 'eng/limited', title: 'Limited', markdown: 'v1' },
    });
    const page = bodyOf(created, PageResponseSchema).page;
    await harness.git.flush();

    for (const body of ['v2', 'v3']) {
      await harness.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${page.id}`,
        headers: headers(),
        payload: { markdown: body },
      });
      await harness.git.flush();
    }

    const history = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${page.id}/history?limit=1`,
      headers: headers(),
    });
    expect(bodyOf(history, HistoryResponseSchema).revisions).toHaveLength(1);
  });

  it('rejects a non-hexadecimal revision with VALIDATION', async () => {
    const { pageIds } = await seed(harness);
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${pageIds[0]}/revisions/not-a-sha`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });
});
