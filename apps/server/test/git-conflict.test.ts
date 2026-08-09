import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GitConflictResponseSchema,
  GitResolveResponseSchema,
  PageResponseSchema,
  hasConflictMarkers,
} from '@tablinum/shared';
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

const FILE = 'eng/deploy.md';

function pageFile(id: string, body: string): string {
  return [
    '---',
    `id: ${id}`,
    'title: "Deploy runbook"',
    'created: "2026-01-01T00:00:00.000Z"',
    'updated: "2026-01-01T00:00:00.000Z"',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** Pretend a pull stopped on a conflict, with the three versions git would hand over. */
function armConflict(id: string, base: string, local: string, remote: string): void {
  harness.git.conflict = {
    files: [FILE],
    message: 'CONFLICT (content): Merge conflict in eng/deploy.md',
    at: '2026-01-01T00:00:00.000Z',
  };
  harness.git.versions = [
    {
      file: FILE,
      base: pageFile(id, base),
      local: pageFile(id, local),
      remote: pageFile(id, remote),
    },
  ];
}

describe('git conflict endpoints', () => {
  it('says there is nothing to resolve on a clean repo', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/git/conflict',
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response, GitConflictResponseSchema);
    expect(body.conflict).toBeNull();
    expect(body.files).toEqual([]);
  });

  it('merges the two sides when they touch different lines', async () => {
    const { pageIds } = await seed(harness);
    const id = pageIds[0] ?? '';
    armConflict(
      id,
      'one\ntwo\nthree\n',
      'ONE\ntwo\nthree\n',
      'one\ntwo\nTHREE\n',
    );

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/git/conflict',
      headers: headers(),
    });
    const body = bodyOf(response, GitConflictResponseSchema);
    expect(body.conflict?.files).toEqual([FILE]);
    expect(body.files).toHaveLength(1);

    const file = body.files[0];
    expect(file?.clean).toBe(true);
    expect(file?.path).toBe('eng/deploy');
    expect(file?.title).toBe('Deploy runbook');
    expect(file?.merged).toContain('ONE');
    expect(file?.merged).toContain('THREE');
    expect(hasConflictMarkers(file?.merged ?? '')).toBe(false);
  });

  it('marks the file unclean and keeps both sides when the same line moved', async () => {
    const { pageIds } = await seed(harness);
    armConflict(pageIds[0] ?? '', 'one\n', 'local wins\n', 'remote wins\n');

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/git/conflict',
      headers: headers(),
    });
    const file = bodyOf(response, GitConflictResponseSchema).files[0];
    expect(file?.clean).toBe(false);
    expect(hasConflictMarkers(file?.merged ?? '')).toBe(true);
    expect(file?.merged).toContain('local wins');
    expect(file?.merged).toContain('remote wins');
  });

  it('writes the chosen text, clears the conflict and republishes the page', async () => {
    const { pageIds } = await seed(harness);
    const id = pageIds[0] ?? '';
    armConflict(id, 'one\n', 'local wins\n', 'remote wins\n');

    const resolved = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/resolve',
      headers: headers(),
      payload: { files: [{ file: FILE, content: pageFile(id, 'agreed text') }] },
    });
    expect(resolved.statusCode).toBe(200);
    const body = bodyOf(resolved, GitResolveResponseSchema);
    expect(body.resolved).toEqual([FILE]);
    expect(body.status.conflict).toBeNull();

    const onDisk = await readFile(join(harness.contentDir, FILE), 'utf8');
    expect(onDisk).toContain('agreed text');

    const page = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${id}`,
      headers: headers(),
    });
    expect(bodyOf(page, PageResponseSchema).page.markdown.trim()).toBe('agreed text');
  });

  it('rejects a resolution with no files', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/resolve',
      headers: headers(),
      payload: { files: [] },
    });
    expect(response.statusCode).toBe(400);
  });
});
