import { describe, expect, it } from 'vitest';
import {
  formatComments,
  formatGitStatus,
  formatHistory,
  formatPage,
  formatPageLine,
  formatSearchHits,
  formatTreeOutline,
} from '../src/format.js';
import {
  makeHit,
  makeNode,
  makePage,
  makeRevision,
  makeSpaceTree,
  makeStatus,
  makeSummary,
  makeThread,
} from './helpers.js';

describe('formatTreeOutline', () => {
  it('indents children under their parent and shows every path', () => {
    const tree = makeSpaceTree({
      tree: [
        makeNode({
          path: 'eng/runbooks',
          title: 'Runbooks',
          icon: '📕',
          children: [makeNode({ path: 'eng/runbooks/deploy', title: 'Deploy' })],
        }),
      ],
    });

    const text = formatTreeOutline([tree]);

    expect(text).toContain('Engineering  (space "eng")');
    expect(text).toContain('  - 📕 Runbooks  [eng/runbooks]');
    expect(text).toContain('    - Deploy  [eng/runbooks/deploy]');
    expect(text).toContain('2 pages in 1 space.');
  });

  it('explains an empty site, and that an agent token cannot fix it by itself', () => {
    const text = formatTreeOutline([]);
    expect(text).toContain('No space is visible to you');
    expect(text).toContain('an agent token cannot start a space');
  });

  it('marks a space with no pages', () => {
    expect(formatTreeOutline([makeSpaceTree()])).toContain('(no pages yet)');
  });
});

describe('formatSearchHits', () => {
  it('numbers the hits and flattens the snippet', () => {
    const hits = [makeHit({ path: 'eng/deploy', snippet: 'line one\n\nline two', score: 4.567 })];

    const text = formatSearchHits(hits, 'deploy');

    expect(text).toContain('1 hit for "deploy"');
    expect(text).toContain('1. Deploy runbook  [eng/deploy]');
    expect(text).toContain('score=4.57');
    expect(text).toContain('line one line two');
  });

  it('suggests what to do when nothing matches', () => {
    expect(formatSearchHits([], 'zzz')).toContain('tablinum_list_tree');
  });
});

describe('formatPage', () => {
  it('returns the body verbatim after the header', () => {
    const markdown = '## Steps\n\n1. Do the thing\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    const page = makePage({
      markdown,
      icon: '🚀',
      order: 10,
    });

    const text = formatPage(page);
    const body = text.slice(text.indexOf('--- markdown ---\n') + '--- markdown ---\n'.length);

    expect(body).toBe(markdown);
    expect(text).toContain(`path: ${page.path}`);
    expect(text).toContain('icon: 🚀');
    expect(text).toContain('order: 10');
  });

  it('omits optional lines when the fields are unset', () => {
    const text = formatPage(makePage());
    expect(text).not.toContain('icon:');
    expect(text).not.toContain('order:');
  });

  it('summarises a page on one line', () => {
    const page = makePage({ order: 3 });
    const line = formatPageLine(page);
    expect(line).toContain(`path=${page.path}`);
    expect(line).toContain('order=3');
  });
});

describe('formatComments', () => {
  const nameOf = (id: string): string => (id === 'us_01J8XYZABCDEFGHJKMNPQRSTVW' ? 'Ana Ruiz' : id);

  it('shows the quoted text, the state and every remark', () => {
    const page = makePage({ markdown: 'The deploy runbook body.\n' });
    const text = formatComments([makeThread()], page, nameOf);

    expect(text).toContain('1 comment thread on eng/deploy');
    expect(text).toContain('[open] thread ct_01J8XYZABCDEFGHJKMNPQRSTVW');
    expect(text).toContain('about: "the deploy runbook"');
    expect(text).toContain('Ana Ruiz  2026-08-08T10:00:00.000Z');
    expect(text).toContain('    Is this still the right order?');
    expect(text).toContain('Comments are not part of the page.');
  });

  it('marks a quote the page no longer holds, and never guesses a new place for it', () => {
    const page = makePage({ markdown: 'The rollout notes body.\n' });
    const text = formatComments([makeThread()], page, nameOf);

    expect(text).toContain('(this text is no longer in the page)');
  });

  it('names a resolved thread and an edited remark', () => {
    const thread = makeThread({
      resolved: true,
      resolvedBy: 'us_01J8XYZABCDEFGHJKMNPQRSTVW',
      resolvedAt: '2026-08-09T10:00:00.000Z',
    });
    const first = thread.comments[0];
    if (first === undefined) throw new Error('the fixture lost its comment');
    const edited = { ...thread, comments: [{ ...first, updated: '2026-08-09T09:00:00.000Z' }] };

    const text = formatComments([edited], makePage(), nameOf);

    expect(text).toContain('[resolved] thread');
    expect(text).toContain('(edited)');
  });

  it('falls back to the user id when the roster does not know the author', () => {
    const text = formatComments([makeThread()], makePage(), (id) => id);
    expect(text).toContain('us_01J8XYZABCDEFGHJKMNPQRSTVW');
  });

  it('explains an empty conversation', () => {
    expect(formatComments([], makePage(), nameOf)).toContain('Nobody has commented on eng/deploy yet.');
  });
});

describe('formatHistory', () => {
  it('lists short shas with the subject line', () => {
    const page = makePage();
    const text = formatHistory([makeRevision({ message: 'Update the runbook\n\nbody' })], page);

    expect(text).toContain('1 revision of eng/deploy');
    expect(text).toContain('a1b2c3d4  2026-08-08T10:00:00.000Z  ana  Update the runbook');
    expect(text).not.toContain('body');
  });

  it('explains an empty history', () => {
    expect(formatHistory([], makePage())).toContain('short delay');
  });
});

describe('formatGitStatus', () => {
  it('reports the branch, the remote and the counters', () => {
    const text = formatGitStatus(makeStatus({ ahead: 2, behind: 1, dirtyFiles: ['eng/deploy.md'] }));

    expect(text).toContain('branch: main');
    expect(text).toContain('remote: git@example.com:acme/docs.git');
    expect(text).toContain('ahead: 2, behind: 1');
    expect(text).toContain('dirty files: 1 file (eng/deploy.md)');
    expect(text).toContain('last commit: a1b2c3d4');
  });

  it('says when no remote is configured and nothing is dirty', () => {
    const text = formatGitStatus(makeStatus({ remote: null, lastCommit: null }));
    expect(text).toContain('remote: none configured');
    expect(text).toContain('dirty files: none');
    expect(text).not.toContain('last commit');
  });
});
