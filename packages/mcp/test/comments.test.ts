import { AppError, markdownToPlainText } from '@tablinum/shared';
import { describe, expect, it } from 'vitest';
import { anchorFor } from '../src/comments.js';

function failure(run: () => unknown): AppError {
  try {
    run();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected anchorFor to throw');
}

describe('anchorFor', () => {
  it('anchors on the prose, so a heading is quoted without its marker', () => {
    const anchor = anchorFor('# Release plan\n\nShip on Friday.\n', 'Release plan');
    expect(anchor.quote).toBe('Release plan');
    expect(anchor.start).toBe(0);
    expect(anchor.prefix).toBe('');
  });

  it('anchors on the words of a link and not on its markdown', () => {
    const anchor = anchorFor('Read the [deploy runbook](/eng/deploy) first.\n', 'deploy runbook');
    expect(anchor.prefix).toContain('Read the ');
    expect(anchor.suffix).toContain(' first.');
  });

  it('anchors inside a bold run and a code span', () => {
    const markdown = 'Set **DEPLOY_KEY** and run `pnpm deploy` after that.\n';
    expect(anchorFor(markdown, 'DEPLOY_KEY').quote).toBe('DEPLOY_KEY');
    expect(anchorFor(markdown, 'pnpm deploy').quote).toBe('pnpm deploy');
  });

  it('takes the first occurrence by default and the asked-for one otherwise', () => {
    const markdown = 'Ship it. Then ship it again.\n';
    const first = anchorFor(markdown, 'it');
    const second = anchorFor(markdown, 'it', 2);
    expect(second.start).toBeGreaterThan(first.start);
    expect(second.prefix).toContain('Then ship ');
  });

  it('matches the case a reader sees, so a lowercase quote misses a capital word', () => {
    const error = failure(() => anchorFor('Ship it.\n', 'ship it'));
    expect(error.code).toBe('VALIDATION');
  });

  it('keeps the prefix and the suffix inside the page', () => {
    const markdown = 'Ship.\n';
    const anchor = anchorFor(markdown, 'Ship');
    const text = markdownToPlainText(markdown);
    expect(text.slice(anchor.start, anchor.start + anchor.quote.length)).toBe('Ship');
    expect(anchor.prefix).toBe('');
    expect(anchor.suffix.length).toBeLessThan(text.length);
  });

  it('trims the quote before it looks for it', () => {
    expect(anchorFor('Ship on Friday.\n', '  Friday  ').quote).toBe('Friday');
  });

  it('refuses an empty quote', () => {
    expect(failure(() => anchorFor('Ship.\n', '   ')).code).toBe('VALIDATION');
  });

  it('refuses a quote that only the markdown holds', () => {
    const error = failure(() => anchorFor('# Release\n', '# Release'));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('without the markdown around it');
  });

  it('refuses an occurrence the page does not reach', () => {
    const error = failure(() => anchorFor('Ship it.\n', 'Ship', 3));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('1 time(s)');
  });
});
