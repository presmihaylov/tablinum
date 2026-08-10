import {
  AppError,
  MAX_QUOTE_LENGTH,
  markdownToPlainText,
  newPageId,
  type CommentAnchor,
} from '@tablinum/shared';
import { describe, expect, it } from 'vitest';
import { TablinumClient } from '../src/client.js';
import { TOOL_SPECS, getToolSpec } from '../src/tools.js';
import {
  makeAccount,
  makeAgent,
  makeHit,
  makeNode,
  makePage,
  makeRevision,
  makeSpaceTree,
  makeStatus,
  makeThread,
  mockFetch,
  reply,
  type Routes,
} from './helpers.js';

const BASE = 'http://tablinum.test';

function harness(routes: Routes) {
  const mock = mockFetch(routes);
  const client = new TablinumClient({ baseUrl: BASE, token: 'tok_1', fetch: mock.fetch });
  return {
    mock,
    run: (name: string, args: unknown) => getToolSpec(name).run(client, args),
  };
}

async function expectError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the tool to throw');
}

describe('tool catalogue', () => {
  it('exposes exactly the documented tools', () => {
    expect(TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'tablinum_search',
      'tablinum_get_page',
      'tablinum_list_tree',
      'tablinum_create_page',
      'tablinum_open_page',
      'tablinum_place_cursor',
      'tablinum_select',
      'tablinum_type',
      'tablinum_erase',
      'tablinum_update_page',
      'tablinum_move_page',
      'tablinum_delete_page',
      'tablinum_list_comments',
      'tablinum_comment',
      'tablinum_reply',
      'tablinum_resolve_comment',
      'tablinum_page_history',
      'tablinum_git_sync',
    ]);
  });

  it('gives every tool a title, a substantial description and a schema', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(120);
      expect(Object.keys(spec.inputShape).length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown tool name with the list of real names', () => {
    expect(() => getToolSpec('tablinum_nope')).toThrowError(/tablinum_search/);
  });

  it('validates arguments before it calls the API', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() => run('tablinum_search', { query: '' }));
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_search', () => {
  it('passes every filter through and formats the hits', async () => {
    const { run, mock } = harness({
      'GET /api/v1/search': { hits: [makeHit({ path: 'eng/deploy' })] },
    });

    const text = await run('tablinum_search', { query: 'deploy', space: 'eng', limit: 5 });

    expect(mock.last().query).toEqual({ q: 'deploy', space: 'eng', limit: '5' });
    expect(text).toContain('[eng/deploy]');
  });

  it('returns guidance when there is no hit', async () => {
    const { run } = harness({ 'GET /api/v1/search': { hits: [] } });
    await expect(run('tablinum_search', { query: 'zzz' })).resolves.toContain('No page matches');
  });
});

describe('tablinum_get_page', () => {
  it('reads by path', async () => {
    const page = makePage({ markdown: '## Steps\n\nDo it.\n' });
    const { run, mock } = harness({ 'GET /api/v1/pages': { page } });

    const text = await run('tablinum_get_page', { path: 'eng/deploy' });

    expect(mock.last().query).toEqual({ path: 'eng/deploy' });
    expect(text).toContain('## Steps\n\nDo it.\n');
  });

  it('reads by id', async () => {
    const page = makePage();
    const { run, mock } = harness({ [`GET /api/v1/pages/${page.id}`]: { page } });

    const text = await run('tablinum_get_page', { id: page.id });

    expect(mock.last().pathname).toBe(`/api/v1/pages/${page.id}`);
    expect(text).toContain(`id: ${page.id}`);
  });

  it('refuses a call with neither id nor path', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() => run('tablinum_get_page', {}));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('tablinum_list_tree');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_list_tree', () => {
  const spaces = [
    makeSpaceTree({ tree: [makeNode({ path: 'eng/deploy', title: 'Deploy' })] }),
    makeSpaceTree({ slug: 'ops', name: 'Operations', tree: [] }),
  ];

  it('renders every space', async () => {
    const { run } = harness({ 'GET /api/v1/tree': { spaces } });
    const text = await run('tablinum_list_tree', {});
    expect(text).toContain('(space "eng")');
    expect(text).toContain('(space "ops")');
  });

  it('filters to one space', async () => {
    const { run } = harness({ 'GET /api/v1/tree': { spaces } });
    const text = await run('tablinum_list_tree', { space: 'ops' });
    expect(text).toContain('(space "ops")');
    expect(text).not.toContain('(space "eng")');
  });

  it('lists the real slugs when the space is unknown', async () => {
    const { run } = harness({ 'GET /api/v1/tree': { spaces } });
    const error = await expectError(() => run('tablinum_list_tree', { space: 'nope' }));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain('eng, ops');
  });
});

describe('tablinum_create_page', () => {
  it('sends every supplied field and nothing else', async () => {
    const page = makePage({ path: 'eng/runbooks/deploy' });
    const { run, mock } = harness({ 'POST /api/v1/pages': { page } });

    const text = await run('tablinum_create_page', {
      path: 'eng/runbooks/deploy',
      title: 'Deploy runbook',
      markdown: 'Body.',
      icon: '🚀',
      order: 2,
    });

    expect(mock.last().body).toEqual({
      path: 'eng/runbooks/deploy',
      title: 'Deploy runbook',
      markdown: 'Body.',
      icon: '🚀',
      order: 2,
    });
    expect(text).toContain('Created page.');
    expect(text).toContain(`id=${page.id}`);
  });

  it('rejects a path that carries the .md extension', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() =>
      run('tablinum_create_page', { path: 'eng/deploy.md', title: 'x', markdown: '' }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });

  it('surfaces a CONFLICT from the server', async () => {
    const { run } = harness({
      'POST /api/v1/pages': reply(409, {
        error: { code: 'CONFLICT', message: 'A page already exists at eng/deploy' },
      }),
    });

    const error = await expectError(() =>
      run('tablinum_create_page', { path: 'eng/deploy', title: 'x', markdown: '' }),
    );
    expect(error.code).toBe('CONFLICT');
  });
});

describe('tablinum_update_page partial body', () => {
  it('does NOT send markdown when markdown is omitted', async () => {
    const page = makePage();
    const { run, mock } = harness({
      [`PATCH /api/v1/pages/${page.id}`]: { page: makePage({ id: page.id, title: 'New title' }) },
    });

    await run('tablinum_update_page', { id: page.id, title: 'New title' });

    const body = mock.last().body as Record<string, unknown>;
    expect(body).toEqual({ title: 'New title' });
    expect('markdown' in body).toBe(false);
  });

  it('sends only the metadata fields that were given', async () => {
    const page = makePage();
    const { run, mock } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page } });

    await run('tablinum_update_page', { id: page.id, icon: '🚀', order: 4 });

    expect(mock.last().body).toEqual({ icon: '🚀', order: 4 });
  });

  it('never touches the body, even when a markdown field is passed', async () => {
    const page = makePage();
    const { run, mock } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page } });

    await run('tablinum_update_page', { id: page.id, title: 'T', markdown: 'ignored' });

    expect(mock.last().body).toEqual({ title: 'T' });
  });

  it('passes null through to clear the icon and the order', async () => {
    const page = makePage();
    const { run, mock } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page } });

    await run('tablinum_update_page', { id: page.id, icon: null, order: null });

    expect(mock.last().body).toEqual({ icon: null, order: null });
  });

  it('refuses an update with no changed field and makes no request', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() => run('tablinum_update_page', { id: newPageId() }));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('Nothing to update');
    expect(mock.calls).toHaveLength(0);
  });

  it('resolves a path to an id before it patches', async () => {
    const page = makePage();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`PATCH /api/v1/pages/${page.id}`]: { page },
    });

    await run('tablinum_update_page', { path: page.path, title: 'New title' });

    expect(mock.calls.map((call) => `${call.method} ${call.pathname}`)).toEqual([
      'GET /api/v1/pages',
      `PATCH /api/v1/pages/${page.id}`,
    ]);
  });

  it('reports which fields changed', async () => {
    const page = makePage();
    const { run } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page } });
    const text = await run('tablinum_update_page', { id: page.id, title: 'T', order: null });
    expect(text).toContain('Updated title, order.');
  });
});

describe('editing a page like a person', () => {
  const PAGE_MD = '# Deploy\n\nRun the pipeline from main.\n\n- build\n- ship\n';

  interface Held {
    anchor: { block: number; offset: number };
    head?: { block: number; offset: number };
  }

  /** A page with three blocks, plus routes for reading it and for its caret. */
  function desk(options: { markdown?: string; at?: Held; extra?: Routes } = {}) {
    const page = makePage({ markdown: options.markdown ?? PAGE_MD });
    const at = options.at;
    const cursor =
      at === undefined
        ? null
        : {
            pageId: page.id,
            path: page.path,
            anchor: at.anchor,
            head: at.head ?? at.anchor,
            updated: '2026-01-01T00:00:00.000Z',
          };
    const routes: Routes = {
      [`GET /api/v1/pages/${page.id}`]: { page },
      'GET /api/v1/pages': { page },
      [`GET /api/v1/pages/${page.id}/cursor`]: { cursor },
      // The real server clamps and defaults `head`; this stands in for exactly that much.
      [`PUT /api/v1/pages/${page.id}/cursor`]: (call) => {
        const sent = call.body as { anchor: unknown; head?: unknown };
        return {
          cursor: {
            pageId: page.id,
            path: page.path,
            updated: '2026-01-01T00:00:00.000Z',
            anchor: sent.anchor,
            head: sent.head ?? sent.anchor,
          },
        };
      },
      [`PATCH /api/v1/pages/${page.id}`]: (call) => ({
        page: { ...page, ...(call.body as Record<string, unknown>) },
      }),
      ...(options.extra ?? {}),
    };
    return { page, ...harness(routes) };
  }

  it('opens a page as numbered blocks and puts the caret at the top', async () => {
    const { page, run, mock } = desk();
    const text = await run('tablinum_open_page', { path: page.path });

    expect(text).toContain('3 blocks');
    expect(text).toContain('  0 | # Deploy');
    expect(text).toContain('  1 | Run the pipeline from main.');
    expect(text).toContain('  2 | - build');
    expect(text).toContain('    | - ship');
    expect(text).toContain('Nothing is selected.');
    expect(mock.last().body).toEqual({ anchor: { block: 0, offset: 0 }, head: { block: 0, offset: 0 } });
  });

  it('puts the caret at a phrase, before it or after it', async () => {
    const { page, run, mock } = desk();

    await run('tablinum_place_cursor', { id: page.id, find: 'pipeline' });
    expect(mock.last().body).toEqual({
      anchor: { block: 1, offset: 8 },
      head: { block: 1, offset: 8 },
    });

    await run('tablinum_place_cursor', { id: page.id, find: 'pipeline', side: 'after' });
    expect(mock.last().body).toEqual({
      anchor: { block: 1, offset: 16 },
      head: { block: 1, offset: 16 },
    });
  });

  it('jumps to the end of the page', async () => {
    const { page, run, mock } = desk();
    await run('tablinum_place_cursor', { id: page.id, where: 'end' });
    expect(mock.last().body).toEqual({
      anchor: { block: 2, offset: 14 },
      head: { block: 2, offset: 14 },
    });
  });

  it('refuses two ways of saying where the caret goes', async () => {
    const { page, run } = desk();
    const error = await expectError(() =>
      run('tablinum_place_cursor', { id: page.id, find: 'ship', block: 0 }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('only one');
  });

  it('says so when the text to find is not on the page', async () => {
    const { page, run } = desk();
    const error = await expectError(() => run('tablinum_place_cursor', { id: page.id, find: 'rollback' }));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('does not appear');
  });

  it('selects a phrase and reports the exact text it has hold of', async () => {
    const { page, run, mock } = desk();
    const text = await run('tablinum_select', { id: page.id, find: 'the pipeline' });

    expect(text).toContain('"the pipeline"');
    expect(mock.last().body).toEqual({
      anchor: { block: 1, offset: 4 },
      head: { block: 1, offset: 16 },
    });
  });

  it('selects a run of blocks, and the whole page', async () => {
    const { page, run, mock } = desk();

    await run('tablinum_select', { id: page.id, block: 1, throughBlock: 2 });
    expect(mock.last().body).toEqual({
      anchor: { block: 1, offset: 0 },
      head: { block: 2, offset: 14 },
    });

    await run('tablinum_select', { id: page.id, all: true });
    expect(mock.last().body).toEqual({
      anchor: { block: 0, offset: 0 },
      head: { block: 2, offset: 14 },
    });
  });

  it('types over the selection and leaves the caret after the new text', async () => {
    const { page, run, mock } = desk({
      at: { anchor: { block: 1, offset: 8 }, head: { block: 1, offset: 16 } },
    });

    const text = await run('tablinum_type', { id: page.id, text: 'release' });

    const patch = mock.matching(`PATCH /api/v1/pages/${page.id}`)[0];
    expect((patch?.body as Record<string, unknown>)['markdown']).toBe(
      '# Deploy\n\nRun the release from main.\n\n- build\n- ship\n',
    );
    expect(text).toContain('Replaced 8 characters with 7');
    expect(mock.last().body).toEqual({ anchor: { block: 1, offset: 15 } });
  });

  it('inserts at a caret that has nothing selected', async () => {
    const { page, run, mock } = desk({ at: { anchor: { block: 2, offset: 14 } } });

    await run('tablinum_type', { id: page.id, text: '\n- verify' });

    const patch = mock.matching(`PATCH /api/v1/pages/${page.id}`)[0];
    expect((patch?.body as Record<string, unknown>)['markdown']).toBe(
      '# Deploy\n\nRun the pipeline from main.\n\n- build\n- ship\n- verify\n',
    );
  });

  it('erases the selection', async () => {
    const { page, run, mock } = desk({
      at: { anchor: { block: 2, offset: 7 }, head: { block: 2, offset: 14 } },
    });

    const text = await run('tablinum_erase', { id: page.id });

    const patch = mock.matching(`PATCH /api/v1/pages/${page.id}`)[0];
    expect((patch?.body as Record<string, unknown>)['markdown']).toBe(
      '# Deploy\n\nRun the pipeline from main.\n\n- build\n',
    );
    expect(text).toContain('Erased 7 characters');
  });

  it('backspaces a count of characters from in front of the caret', async () => {
    const { page, run, mock } = desk({ at: { anchor: { block: 2, offset: 14 } } });

    await run('tablinum_erase', { id: page.id, before: 4 });

    const patch = mock.matching(`PATCH /api/v1/pages/${page.id}`)[0];
    expect((patch?.body as Record<string, unknown>)['markdown']).toBe(
      '# Deploy\n\nRun the pipeline from main.\n\n- build\n- \n',
    );
  });

  it('refuses to erase when nothing is selected and no count is given', async () => {
    const { page, run, mock } = desk();
    const error = await expectError(() => run('tablinum_erase', { id: page.id }));

    expect(error.code).toBe('VALIDATION');
    expect(mock.matching(`PATCH /api/v1/pages/${page.id}`)).toHaveLength(0);
  });

  it('refuses an edit that would change nothing', async () => {
    const { page, run, mock } = desk({
      at: { anchor: { block: 1, offset: 8 }, head: { block: 1, offset: 16 } },
    });

    const error = await expectError(() => run('tablinum_type', { id: page.id, text: 'pipeline' }));

    expect(error.code).toBe('VALIDATION');
    expect(mock.matching(`PATCH /api/v1/pages/${page.id}`)).toHaveLength(0);
  });
});

describe('tablinum_move_page', () => {
  it('patches the path only', async () => {
    const page = makePage();
    const moved = makePage({ id: page.id, path: 'ops/deploy' });
    const { run, mock } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page: moved } });

    const text = await run('tablinum_move_page', { id: page.id, newPath: 'ops/deploy' });

    expect(mock.last().body).toEqual({ path: 'ops/deploy' });
    expect(text).toContain('Moved page to ops/deploy.');
  });

  it('rejects an invalid target path before any request', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() =>
      run('tablinum_move_page', { id: newPageId(), newPath: 'ops/deploy/' }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_delete_page', () => {
  it('deletes a single page without the recursive flag', async () => {
    const page = makePage();
    const { run, mock } = harness({
      [`DELETE /api/v1/pages/${page.id}`]: { deleted: ['eng/deploy'] },
    });

    const text = await run('tablinum_delete_page', { id: page.id });

    expect(mock.last().query).toEqual({});
    expect(text).toContain('Deleted 1 page:');
    expect(text).toContain('- eng/deploy');
  });

  it('passes recursive=true and lists every deleted path', async () => {
    const page = makePage();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`DELETE /api/v1/pages/${page.id}`]: { deleted: ['eng/runbooks', 'eng/runbooks/deploy'] },
    });

    const text = await run('tablinum_delete_page', { path: 'eng/runbooks', recursive: true });

    expect(mock.last().query).toEqual({ recursive: 'true' });
    expect(text).toContain('Deleted 2 pages:');
    expect(text).toContain('- eng/runbooks/deploy');
  });
});

describe('tablinum_list_comments', () => {
  it('resolves the page, reads its threads and names the authors', async () => {
    const page = makePage();
    const ana = makeAccount();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      'GET /api/v1/users': { users: [ana] },
      'GET /api/v1/agents': { agents: [makeAgent()] },
      [`GET /api/v1/pages/${page.id}/comments`]: {
        threads: [makeThread({ pageId: page.id, anchor: null })],
      },
    });

    const text = await run('tablinum_list_comments', { path: page.path });

    expect(mock.matching(`GET /api/v1/pages/${page.id}/comments`)[0]?.query).toEqual({});
    expect(text).toContain('1 comment thread on eng/deploy');
    expect(text).toContain('[open] thread ct_01J8XYZABCDEFGHJKMNPQRSTVW');
    expect(text).toContain('about: the whole page');
    expect(text).toContain('Ana Ruiz');
    expect(text).toContain('Is this still the right order?');
  });

  it('asks for the open threads only when it is told to', async () => {
    const page = makePage();
    const { run, mock } = harness({
      [`GET /api/v1/pages/${page.id}`]: { page },
      'GET /api/v1/users': { users: [makeAccount()] },
      'GET /api/v1/agents': { agents: [] },
      [`GET /api/v1/pages/${page.id}/comments`]: { threads: [makeThread({ pageId: page.id })] },
    });

    await run('tablinum_list_comments', { id: page.id, open: true });

    expect(mock.matching(`GET /api/v1/pages/${page.id}/comments`)[0]?.query).toEqual({
      resolved: 'false',
    });
  });

  it('says so when nobody has commented, without asking for the roster', async () => {
    const page = makePage();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`GET /api/v1/pages/${page.id}/comments`]: { threads: [] },
    });

    const text = await run('tablinum_list_comments', { path: page.path });

    expect(text).toContain('Nobody has commented on eng/deploy yet.');
    expect(mock.matching('GET /api/v1/users')).toHaveLength(0);
  });

  it('names an agent that left a remark, and not "a former member"', async () => {
    const page = makePage();
    const bot = makeAgent();
    const thread = makeThread({ pageId: page.id, anchor: null });
    const first = thread.comments[0];
    if (first === undefined) throw new Error('the fixture has no comment');
    const { run } = harness({
      'GET /api/v1/pages': { page },
      'GET /api/v1/users': { users: [] },
      'GET /api/v1/agents': { agents: [bot] },
      [`GET /api/v1/pages/${page.id}/comments`]: {
        threads: [{ ...thread, comments: [{ ...first, author: bot.id }] }],
      },
    });

    const text = await run('tablinum_list_comments', { path: page.path });

    expect(text).toContain('Doc Bot');
    expect(text).not.toContain('a former member');
  });

  it('reads no roster at all when nobody has commented', async () => {
    const page = makePage();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`GET /api/v1/pages/${page.id}/comments`]: { threads: [] },
    });

    await run('tablinum_list_comments', { path: page.path });

    expect(mock.matching('GET /api/v1/agents')).toHaveLength(0);
  });
});

describe('tablinum_comment', () => {
  const prose = '# Release\n\nShip the [runbook](/eng/deploy) on Friday. Ship it twice.\n';

  it('anchors the thread on the prose a reader sees, not on the markdown', async () => {
    const page = makePage({ markdown: prose });
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`POST /api/v1/pages/${page.id}/comments`]: (call) => ({
        thread: makeThread({
          pageId: page.id,
          anchor: (call.body as { anchor: CommentAnchor }).anchor,
          comments: [
            {
              id: 'cm_01J8XYZABCDEFGHJKMNPQRSTVX',
              threadId: 'ct_01J8XYZABCDEFGHJKMNPQRSTVW',
              author: 'ag_01J8XYZABCDEFGHJKMNPQRSTVW',
              body: 'Which Friday?',
              created: '2026-08-08T11:00:00.000Z',
              updated: '2026-08-08T11:00:00.000Z',
            },
          ],
        }),
      }),
    });

    const text = await run('tablinum_comment', {
      path: page.path,
      body: 'Which Friday?',
      quote: 'Release',
    });

    const sent = mock.last().body as { body: string; anchor: CommentAnchor };
    expect(sent.body).toBe('Which Friday?');
    expect(sent.anchor.quote).toBe('Release');
    // The heading marker is gone from the prose, so the quote starts the document.
    expect(sent.anchor.start).toBe(0);
    expect(text).toContain('Left a comment on eng/deploy');
    expect(text).toContain('Which Friday?');
    expect(text).toContain('the markdown file did not change');
  });

  it('quotes the words of a link rather than its markdown', async () => {
    const page = makePage({ markdown: prose });
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`POST /api/v1/pages/${page.id}/comments`]: { thread: makeThread({ pageId: page.id }) },
    });

    await run('tablinum_comment', { path: page.path, body: 'Stale link.', quote: 'runbook' });

    const sent = mock.last().body as { anchor: CommentAnchor };
    expect(sent.anchor.prefix).toContain('Ship the ');
    expect(sent.anchor.suffix).toContain(' on Friday');
  });

  it('picks the occurrence it is told to pick', async () => {
    const page = makePage({ markdown: prose });
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`POST /api/v1/pages/${page.id}/comments`]: { thread: makeThread({ pageId: page.id }) },
    });

    await run('tablinum_comment', {
      path: page.path,
      body: 'Twice?',
      quote: 'Ship',
      occurrence: 2,
    });

    const first = markdownToPlainText(prose).indexOf('Ship');
    const sent = mock.last().body as { anchor: CommentAnchor };
    expect(sent.anchor.start).toBeGreaterThan(first);
  });

  it('sends no anchor when the remark is about the whole page', async () => {
    const page = makePage({ markdown: prose });
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`POST /api/v1/pages/${page.id}/comments`]: {
        thread: makeThread({ pageId: page.id, anchor: null }),
      },
    });

    const text = await run('tablinum_comment', { path: page.path, body: 'Needs an owner.' });

    expect(mock.last().body).toEqual({ body: 'Needs an owner.' });
    expect(text).toContain('about: the whole page');
  });

  it('refuses a quote the page does not say, and writes nothing', async () => {
    const page = makePage({ markdown: prose });
    const { run, mock } = harness({ 'GET /api/v1/pages': { page } });

    const error = await expectError(() =>
      run('tablinum_comment', { path: page.path, body: 'Hm.', quote: '# Release' }),
    );

    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('as a reader sees it');
    expect(mock.matching(`POST /api/v1/pages/${page.id}/comments`)).toHaveLength(0);
  });

  it('refuses an occurrence past the last one', async () => {
    const page = makePage({ markdown: prose });
    const { run } = harness({ 'GET /api/v1/pages': { page } });

    const error = await expectError(() =>
      run('tablinum_comment', { path: page.path, body: 'Hm.', quote: 'Ship', occurrence: 9 }),
    );

    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('occurrence 9');
  });

  it('refuses a quote longer than a thread may hold', async () => {
    const long = 'word '.repeat(400);
    const page = makePage({ markdown: long });
    const { run } = harness({ 'GET /api/v1/pages': { page } });

    const error = await expectError(() =>
      run('tablinum_comment', { path: page.path, body: 'Hm.', quote: long.trim() }),
    );

    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain(String(MAX_QUOTE_LENGTH));
  });

  it('refuses an empty body before it calls the API', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() => run('tablinum_comment', { id: newPageId(), body: '' }));
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_reply', () => {
  it('appends a remark to the thread and reads the page back for its path', async () => {
    const page = makePage();
    const thread = makeThread({ pageId: page.id });
    const answered = {
      ...thread,
      comments: [
        ...thread.comments,
        {
          id: 'cm_01J8XYZABCDEFGHJKMNPQRSTVX',
          threadId: thread.id,
          author: 'ag_01J8XYZABCDEFGHJKMNPQRSTVW',
          body: 'Fixed, the order now matches the runbook.',
          created: '2026-08-08T11:00:00.000Z',
          updated: '2026-08-08T11:00:00.000Z',
        },
      ],
    };
    const { run, mock } = harness({
      [`POST /api/v1/comment-threads/${thread.id}/replies`]: { thread: answered },
      [`GET /api/v1/pages/${page.id}`]: { page },
    });

    const text = await run('tablinum_reply', { thread: thread.id, body: 'Fixed, the order now matches the runbook.' });

    expect(mock.calls[0]?.body).toEqual({ body: 'Fixed, the order now matches the runbook.' });
    expect(text).toContain('Replied to a comment on eng/deploy');
    expect(text).toContain('2 remarks so far');
    expect(text).toContain('Fixed, the order now matches the runbook.');
  });

  it('refuses an empty reply before it calls the API', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() => run('tablinum_reply', { thread: 'ct_1', body: '' }));
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_resolve_comment', () => {
  it('closes a thread by default', async () => {
    const page = makePage();
    const thread = makeThread({ pageId: page.id });
    const { run, mock } = harness({
      [`PATCH /api/v1/comment-threads/${thread.id}`]: {
        thread: { ...thread, resolved: true },
      },
      [`GET /api/v1/pages/${page.id}`]: { page },
    });

    const text = await run('tablinum_resolve_comment', { thread: thread.id });

    expect(mock.calls[0]?.body).toEqual({ resolved: true });
    expect(text).toContain('Resolved a comment on eng/deploy');
    expect(text).toContain('[resolved] thread');
  });

  it('reopens a thread when it is told to', async () => {
    const page = makePage();
    const thread = makeThread({ pageId: page.id, resolved: true });
    const { run, mock } = harness({
      [`PATCH /api/v1/comment-threads/${thread.id}`]: {
        thread: { ...thread, resolved: false },
      },
      [`GET /api/v1/pages/${page.id}`]: { page },
    });

    const text = await run('tablinum_resolve_comment', { thread: thread.id, resolved: false });

    expect(mock.calls[0]?.body).toEqual({ resolved: false });
    expect(text).toContain('Reopened a comment on eng/deploy');
  });
});

describe('tablinum_page_history', () => {
  it('resolves the page then reads its commits', async () => {
    const page = makePage();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`GET /api/v1/pages/${page.id}/history`]: { revisions: [makeRevision()] },
    });

    const text = await run('tablinum_page_history', { path: page.path, limit: 5 });

    expect(mock.last().query).toEqual({ limit: '5' });
    expect(text).toContain('1 revision of eng/deploy');
    expect(text).toContain('a1b2c3d4');
  });

  it('rejects a limit above the API maximum', async () => {
    const { run } = harness({});
    const error = await expectError(() =>
      run('tablinum_page_history', { id: newPageId(), limit: 5000 }),
    );
    expect(error.code).toBe('VALIDATION');
  });
});

describe('tablinum_git_sync', () => {
  const routes = (): Routes => ({
    'POST /api/v1/git/commit': { sha: 'abc1234def5678' },
    'POST /api/v1/git/pull': { status: makeStatus({ behind: 0 }), pulled: 2 },
    'POST /api/v1/git/push': { status: makeStatus(), pushed: true },
  });

  it('commits and pulls, and skips the push by default', async () => {
    const { run, mock } = harness(routes());

    const text = await run('tablinum_git_sync', {});

    expect(mock.calls.map((call) => call.pathname)).toEqual([
      '/api/v1/git/commit',
      '/api/v1/git/pull',
    ]);
    expect(text).toContain('Committed pending edits as abc1234d.');
    expect(text).toContain('Pulled 2 commits from the remote.');
    expect(text).toContain('Skipped the push.');
    expect(text).toContain('branch: main');
  });

  it('pushes when asked', async () => {
    const { run, mock } = harness(routes());

    const text = await run('tablinum_git_sync', { push: true });

    expect(mock.calls.map((call) => call.pathname)).toEqual([
      '/api/v1/git/commit',
      '/api/v1/git/pull',
      '/api/v1/git/push',
    ]);
    expect(text).toContain('Pushed to the remote.');
  });

  it('says when there was nothing to commit and nothing to push', async () => {
    const { run } = harness({
      ...routes(),
      'POST /api/v1/git/commit': { sha: null },
      'POST /api/v1/git/pull': { status: makeStatus(), pulled: 0 },
      'POST /api/v1/git/push': { status: makeStatus(), pushed: false },
    });

    const text = await run('tablinum_git_sync', { push: true });

    expect(text).toContain('No pending edit to commit.');
    expect(text).toContain('Pulled 0 commits from the remote.');
    expect(text).toContain('Nothing to push');
  });

  it('maps a failed push to GIT_ERROR', async () => {
    const { run } = harness({
      ...routes(),
      'POST /api/v1/git/push': reply(502, {
        error: { code: 'GIT_ERROR', message: 'remote rejected the push' },
      }),
    });

    const error = await expectError(() => run('tablinum_git_sync', { push: true }));
    expect(error.code).toBe('GIT_ERROR');
  });
});
