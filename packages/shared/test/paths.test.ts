import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import {
  assertValidPagePath,
  assetRelPath,
  assetUrl,
  baseName,
  depth,
  isDescendantOf,
  isIndexFile,
  isValidPagePath,
  joinPath,
  pagePathToRelFile,
  parentPath,
  relFileToPagePath,
  replacePathPrefix,
  segments,
  spaceFileRelPath,
  spaceOf,
} from '../src/paths.js';

describe('isValidPagePath', () => {
  it('accepts normal relative paths', () => {
    expect(isValidPagePath('eng')).toBe(true);
    expect(isValidPagePath('eng/deploy')).toBe(true);
    expect(isValidPagePath('eng/runbooks/deploy-v2')).toBe(true);
    expect(isValidPagePath('team.docs/q3.plan')).toBe(true);
  });

  const traversal = [
    '..',
    '../etc/passwd',
    'eng/../../etc',
    'eng/..',
    '../',
    'eng/./deploy',
    '.',
  ];
  it.each(traversal)('rejects traversal %j', (path) => {
    expect(isValidPagePath(path)).toBe(false);
  });

  const malformed = [
    '',
    '/',
    '/eng',
    'eng/',
    '//eng',
    'eng//deploy',
    'eng/ /deploy',
    ' eng',
    'eng ',
    'eng\\deploy',
    'eng/deploy\u0000',
    'eng/de:ploy',
    'eng/de*ploy',
    'eng/de?ploy',
    'eng/de"ploy',
    'eng/de<ploy',
    'eng/de>ploy',
    'eng/de|ploy',
    'eng/deploy.',
    'eng/deploy.md',
    'eng/DEPLOY.MD',
    'eng/index',
    'index',
    '_assets',
    '_assets/pg_1/logo.png',
    'eng/_secret',
    // The scanner skips every dot-name, so these would be written but never indexed.
    '.git',
    '.gitdocs/config',
    'eng/.hidden',
    '.hidden/child',
  ];
  it.each(malformed)('rejects malformed %j', (path) => {
    expect(isValidPagePath(path)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidPagePath(undefined)).toBe(false);
    expect(isValidPagePath(null)).toBe(false);
    expect(isValidPagePath(42)).toBe(false);
    expect(isValidPagePath(['eng'])).toBe(false);
  });

  it('rejects over-long segments', () => {
    expect(isValidPagePath('a'.repeat(120))).toBe(true);
    expect(isValidPagePath('a'.repeat(121))).toBe(false);
  });
});

describe('assertValidPagePath', () => {
  it('returns the path when valid', () => {
    expect(assertValidPagePath('eng/deploy')).toBe('eng/deploy');
  });

  it('throws a VALIDATION AppError on traversal', () => {
    expect(() => assertValidPagePath('../etc')).toThrow(AppError);
    try {
      assertValidPagePath('../etc');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION');
      expect((err as AppError).status).toBe(400);
    }
  });
});

describe('pagePathToRelFile', () => {
  it('maps a leaf page to <path>.md', () => {
    expect(pagePathToRelFile('eng/deploy', false)).toBe('eng/deploy.md');
    expect(pagePathToRelFile('eng', false)).toBe('eng.md');
  });

  it('maps a page with children to <path>/index.md', () => {
    expect(pagePathToRelFile('eng', true)).toBe('eng/index.md');
    expect(pagePathToRelFile('eng/runbooks', true)).toBe('eng/runbooks/index.md');
  });

  it('rejects traversal before touching the filesystem', () => {
    expect(() => pagePathToRelFile('../etc', false)).toThrow(AppError);
    expect(() => pagePathToRelFile('eng/../../etc', true)).toThrow(AppError);
  });
});

describe('relFileToPagePath', () => {
  it('strips the extension', () => {
    expect(relFileToPagePath('eng/deploy.md')).toBe('eng/deploy');
  });

  it('strips a trailing /index', () => {
    expect(relFileToPagePath('eng/runbooks/index.md')).toBe('eng/runbooks');
    expect(relFileToPagePath('eng/index.md')).toBe('eng');
  });

  it('normalizes leading ./ and backslashes', () => {
    expect(relFileToPagePath('./eng/deploy.md')).toBe('eng/deploy');
    expect(relFileToPagePath('eng\\deploy.md')).toBe('eng/deploy');
  });

  it('round-trips with pagePathToRelFile', () => {
    for (const [path, hasChildren] of [
      ['eng', false],
      ['eng', true],
      ['eng/runbooks/deploy', false],
      ['eng/runbooks', true],
    ] as const) {
      expect(relFileToPagePath(pagePathToRelFile(path, hasChildren))).toBe(path);
    }
  });

  it('rejects non-markdown files', () => {
    expect(() => relFileToPagePath('eng/deploy.txt')).toThrow(AppError);
    expect(() => relFileToPagePath('eng/_space.yml')).toThrow(AppError);
  });

  it('rejects the content root index and traversal', () => {
    expect(() => relFileToPagePath('index.md')).toThrow(AppError);
    expect(() => relFileToPagePath('../secrets.md')).toThrow(AppError);
    expect(() => relFileToPagePath('eng/../../secrets.md')).toThrow(AppError);
    expect(() => relFileToPagePath('_assets/pg_1/note.md')).toThrow(AppError);
  });
});

describe('isIndexFile', () => {
  it('detects index files only', () => {
    expect(isIndexFile('eng/index.md')).toBe(true);
    expect(isIndexFile('eng\\index.md')).toBe(true);
    expect(isIndexFile('eng/deploy.md')).toBe(false);
    expect(isIndexFile('index.md')).toBe(false);
  });
});

describe('parentPath / spaceOf / baseName / depth / segments', () => {
  it('walks up one level', () => {
    expect(parentPath('eng/runbooks/deploy')).toBe('eng/runbooks');
    expect(parentPath('eng/deploy')).toBe('eng');
  });

  it('returns null at the space root', () => {
    expect(parentPath('eng')).toBeNull();
  });

  it('reads the space slug', () => {
    expect(spaceOf('eng/runbooks/deploy')).toBe('eng');
    expect(spaceOf('eng')).toBe('eng');
  });

  it('reads the last segment', () => {
    expect(baseName('eng/runbooks/deploy')).toBe('deploy');
    expect(baseName('eng')).toBe('eng');
  });

  it('counts segments', () => {
    expect(depth('eng')).toBe(1);
    expect(depth('eng/runbooks/deploy')).toBe(3);
    expect(segments('eng/runbooks')).toEqual(['eng', 'runbooks']);
    expect(segments('')).toEqual([]);
  });

  it('rejects traversal', () => {
    expect(() => parentPath('../etc')).toThrow(AppError);
    expect(() => spaceOf('/eng')).toThrow(AppError);
    expect(() => baseName('eng/')).toThrow(AppError);
    expect(() => depth('')).toThrow(AppError);
  });
});

describe('joinPath', () => {
  it('joins and trims stray slashes', () => {
    expect(joinPath('eng', 'deploy')).toBe('eng/deploy');
    expect(joinPath('eng/', '/deploy')).toBe('eng/deploy');
    expect(joinPath('eng', 'runbooks', 'deploy')).toBe('eng/runbooks/deploy');
    expect(joinPath('', 'eng')).toBe('eng');
  });

  it('rejects traversal in any fragment', () => {
    expect(() => joinPath('eng', '..')).toThrow(AppError);
    expect(() => joinPath('..', 'etc')).toThrow(AppError);
    expect(() => joinPath('eng', '../../etc')).toThrow(AppError);
    expect(() => joinPath('', '')).toThrow(AppError);
  });
});

describe('isDescendantOf / replacePathPrefix', () => {
  it('detects descendants', () => {
    expect(isDescendantOf('eng/runbooks/deploy', 'eng')).toBe(true);
    expect(isDescendantOf('eng', 'eng')).toBe(false);
    expect(isDescendantOf('engineering/x', 'eng')).toBe(false);
  });

  it('rewrites a moved subtree', () => {
    expect(replacePathPrefix('eng/runbooks/deploy', 'eng', 'ops')).toBe('ops/runbooks/deploy');
    expect(replacePathPrefix('eng', 'eng', 'ops')).toBe('ops');
  });

  it('rejects unrelated paths and bad targets', () => {
    expect(() => replacePathPrefix('sales/deck', 'eng', 'ops')).toThrow(AppError);
    expect(() => replacePathPrefix('eng/deploy', 'eng', '../ops')).toThrow(AppError);
  });
});

describe('space and asset paths', () => {
  it('builds the space descriptor path', () => {
    expect(spaceFileRelPath('eng')).toBe('eng/_space.yml');
  });

  it('rejects multi-segment or traversing slugs', () => {
    expect(() => spaceFileRelPath('eng/sub')).toThrow(AppError);
    expect(() => spaceFileRelPath('..')).toThrow(AppError);
  });

  it('builds asset paths and urls', () => {
    expect(assetRelPath('pg_1', 'logo.png')).toBe('_assets/pg_1/logo.png');
    expect(assetUrl('pg_1', 'logo.png')).toBe('/_assets/pg_1/logo.png');
    expect(assetRelPath('pg_1', 'my photo.png')).toBe('_assets/pg_1/my photo.png');
  });

  it('strips directories out of an uploaded filename', () => {
    expect(assetRelPath('pg_1', '../../etc/passwd')).toBe('_assets/pg_1/passwd');
    expect(assetRelPath('pg_1', 'C:\\windows\\evil.exe')).toBe('_assets/pg_1/evil.exe');
  });

  it('rejects filenames that resolve to nothing', () => {
    expect(() => assetRelPath('pg_1', '')).toThrow(AppError);
    expect(() => assetRelPath('pg_1', 'a/b/..')).toThrow(AppError);
    expect(() => assetRelPath('pg_1', 'nul\u0000.png')).toThrow(AppError);
  });
});
