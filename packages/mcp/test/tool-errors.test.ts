import { conflict, gitError, notFound, unauthorized, validation } from '@tablinum/shared';
import { describe, expect, it } from 'vitest';
import { STYLE_GUIDE, styleGuideFor } from '../src/style-guide.js';
import { toolErrorMessage } from '../src/tool-errors.js';

describe('toolErrorMessage', () => {
  it('names the code, the message and the next step', () => {
    const text = toolErrorMessage(notFound('No page at eng/nope'));
    expect(text).toContain('NOT_FOUND: No page at eng/nope');
    expect(text).toContain('tablinum_list_tree');
  });

  it('tells the model to update instead of recreating on a conflict', () => {
    expect(toolErrorMessage(conflict('exists'))).toContain('tablinum_update_page');
  });

  it('explains the path format on a validation error', () => {
    expect(toolErrorMessage(validation('bad path'))).toContain('eng/runbooks/deploy');
  });

  it('names the token environment variable when unauthorized', () => {
    expect(toolErrorMessage(unauthorized('nope'))).toContain('TABLINUM_TOKEN');
  });

  it('points at tablinum_git_sync on a git failure', () => {
    expect(toolErrorMessage(gitError('remote rejected'))).toContain('tablinum_git_sync');
  });

  it('normalises a plain Error into INTERNAL', () => {
    expect(toolErrorMessage(new Error('boom'))).toContain('INTERNAL: boom');
  });

  it('normalises a thrown non-Error', () => {
    expect(toolErrorMessage('boom')).toContain('INTERNAL: boom');
  });
});

describe('style guide', () => {
  it('states the rules that stop an agent from corrupting a page', () => {
    expect(STYLE_GUIDE).toContain('Never write a `---` frontmatter block');
    expect(STYLE_GUIDE).toContain('tablinum_open_page');
    expect(STYLE_GUIDE).toContain('tablinum_type replaces whatever is selected');
    expect(STYLE_GUIDE).toContain('It never touches the body');
    expect(STYLE_GUIDE).toContain('[[page-path]]');
  });

  it('appends space guidance only when a space is named', () => {
    expect(styleGuideFor(undefined)).toBe(STYLE_GUIDE);
    expect(styleGuideFor('  ')).toBe(STYLE_GUIDE);
    expect(styleGuideFor('eng')).toContain('For the "eng" space');
  });
});
