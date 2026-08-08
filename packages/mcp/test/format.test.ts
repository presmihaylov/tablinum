import { describe, expect, it } from 'vitest';
import {
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

  it('explains an empty site', () => {
    expect(formatTreeOutline([])).toContain('No spaces exist yet');
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
    expect(formatSearchHits([], 'zzz')).toContain('gitdocs_list_tree');
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
