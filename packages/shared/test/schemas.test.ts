import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { newPageId } from '../src/ids.js';
import {
  CreatePageBodySchema,
  CreateSpaceBodySchema,
  DeletePageQuerySchema,
  FrontmatterSchema,
  GitCommitBodySchema,
  GitResolveBodySchema,
  GitStatusResponseSchema,
  PageSchema,
  SearchQuerySchema,
  TreeResponseSchema,
  UpdatePageBodySchema,
  parseOrThrow,
} from '../src/schemas.js';

const id = newPageId();
const frontmatter = {
  id,
  title: 'Deploy runbook',
  icon: '\u{1F680}',
  order: 10,
  created: '2026-08-08T10:00:00.000Z',
  updated: '2026-08-08T10:00:00.000Z',
};

describe('FrontmatterSchema', () => {
  it('accepts the documented shape', () => {
    expect(FrontmatterSchema.parse(frontmatter).title).toBe('Deploy runbook');
  });

  it('accepts the minimal shape', () => {
    expect(
      FrontmatterSchema.parse({
        id,
        title: 'T',
        created: '2026-08-08T10:00:00.000Z',
        updated: '2026-08-08T10:00:00.000Z',
      }).icon,
    ).toBeUndefined();
  });

  it('rejects a bad id, bad dates and an empty title', () => {
    expect(FrontmatterSchema.safeParse({ ...frontmatter, id: 'nope' }).success).toBe(false);
    expect(FrontmatterSchema.safeParse({ ...frontmatter, created: 'yesterday' }).success).toBe(false);
    expect(FrontmatterSchema.safeParse({ ...frontmatter, title: '' }).success).toBe(false);
  });
});

describe('PageSchema', () => {
  const page = {
    ...frontmatter,
    path: 'eng/deploy',
    space: 'eng',
    filePath: '/abs/content/eng/deploy.md',
    hasChildren: false,
    markdown: '# Deploy\n',
    rev: 'a-1b2c3d',
  };

  it('accepts a full page', () => {
    expect(PageSchema.parse(page).markdown).toBe('# Deploy\n');
  });

  it('rejects a traversing path', () => {
    expect(PageSchema.safeParse({ ...page, path: '../secrets' }).success).toBe(false);
    expect(PageSchema.safeParse({ ...page, space: 'eng/sub' }).success).toBe(false);
  });
});

describe('TreeResponseSchema', () => {
  it('parses a recursive tree', () => {
    const parsed = TreeResponseSchema.parse({
      spaces: [
        {
          slug: 'eng',
          name: 'Engineering',
          tree: [
            {
              id,
              path: 'eng/runbooks',
              title: 'Runbooks',
              children: [{ id, path: 'eng/runbooks/deploy', title: 'Deploy', children: [] }],
            },
          ],
        },
      ],
    });
    expect(parsed.spaces[0]?.tree[0]?.children[0]?.path).toBe('eng/runbooks/deploy');
  });
});

describe('request bodies', () => {
  it('validates page creation', () => {
    expect(CreatePageBodySchema.parse({ path: 'eng/x', title: 'X' }).markdown).toBeUndefined();
    expect(CreatePageBodySchema.safeParse({ path: 'eng/x' }).success).toBe(false);
    expect(CreatePageBodySchema.safeParse({ path: '/eng/x', title: 'X' }).success).toBe(false);
  });

  it('requires at least one field on update', () => {
    expect(UpdatePageBodySchema.safeParse({}).success).toBe(false);
    expect(UpdatePageBodySchema.parse({ path: 'ops/x' }).path).toBe('ops/x');
    expect(UpdatePageBodySchema.parse({ order: null }).order).toBeNull();
  });

  it('validates space creation', () => {
    expect(CreateSpaceBodySchema.parse({ slug: 'eng', name: 'Engineering' }).slug).toBe('eng');
    expect(CreateSpaceBodySchema.safeParse({ slug: 'eng/sub', name: 'x' }).success).toBe(false);
    expect(CreateSpaceBodySchema.safeParse({ slug: '_assets', name: 'x' }).success).toBe(false);
  });

  it('refuses a commit message carrying the git log separators', () => {
    expect(GitCommitBodySchema.parse({ message: 'docs: a real message' }).message).toBe(
      'docs: a real message',
    );
    // A real message spans several lines, so only the control bytes are refused.
    expect(GitCommitBodySchema.safeParse({ message: 'subject\n\nbody' }).success).toBe(true);
    expect(GitCommitBodySchema.safeParse({ message: `forged${String.fromCharCode(30)}row` }).success).toBe(false);
    expect(GitCommitBodySchema.safeParse({ message: `forged${String.fromCharCode(31)}field` }).success).toBe(false);
    expect(GitCommitBodySchema.safeParse({ message: 'ends\u0000here' }).success).toBe(false);
    expect(GitCommitBodySchema.safeParse({ message: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('refuses a conflict resolution that names anything but a repo file', () => {
    const good = { files: [{ file: 'eng/index.md', content: 'body' }] };
    expect(GitResolveBodySchema.parse(good).files[0]?.file).toBe('eng/index.md');

    const refused = [
      '.git/config',
      '.GIT/hooks/post-commit',
      'eng/.git/config',
      'eng\\..\\.git\\config',
      '../escape.md',
      '/etc/passwd',
      'C:/windows/x',
    ];
    for (const file of refused) {
      expect(GitResolveBodySchema.safeParse({ files: [{ file, content: 'x' }] }).success).toBe(false);
    }
    expect(
      GitResolveBodySchema.safeParse({ files: good.files, message: 'a\u001eb' }).success,
    ).toBe(false);
  });
});

describe('query params', () => {
  it('coerces strings', () => {
    expect(DeletePageQuerySchema.parse({ recursive: 'true' }).recursive).toBe(true);
    expect(DeletePageQuerySchema.parse({ recursive: 'false' }).recursive).toBe(false);
    expect(DeletePageQuerySchema.parse({}).recursive).toBeUndefined();
    expect(SearchQuerySchema.parse({ q: 'deploy', limit: '25' }).limit).toBe(25);
  });

  it('bounds the limit', () => {
    expect(SearchQuerySchema.safeParse({ q: 'a', limit: '0' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: 'a', limit: '9999' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: '' }).success).toBe(false);
  });
});

describe('responses', () => {
  it('parses git status', () => {
    const parsed = GitStatusResponseSchema.parse({
      status: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        dirtyFiles: ['eng/deploy.md'],
        remote: null,
        lastCommit: null,
        conflict: null,
      },
    });
    expect(parsed.status.branch).toBe('main');
  });
});

describe('parseOrThrow', () => {
  it('returns parsed data', () => {
    expect(parseOrThrow(CreatePageBodySchema, { path: 'eng/x', title: 'X' }).path).toBe('eng/x');
  });

  it('throws a VALIDATION AppError naming the field', () => {
    try {
      parseOrThrow(CreatePageBodySchema, { path: '../x' }, 'body');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION');
      expect((err as AppError).status).toBe(400);
      expect((err as AppError).message).toContain('path');
      expect((err as AppError).message).toContain('title');
    }
  });
});
