import { z } from 'zod';
import { validation } from './errors.js';
import { isPageId } from './ids.js';
import { isValidPagePath } from './paths.js';
import type { TreeNode } from './types.js';

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export const IsoDateSchema = z.string().regex(ISO_RE, 'Expected an ISO 8601 timestamp');

export const PageIdSchema = z.string().refine(isPageId, 'Expected a page id like "pg_<ULID>"');

export const PagePathSchema = z
  .string()
  .refine(isValidPagePath, 'Expected a relative page path like "eng/runbooks/deploy"');

export const SpaceSlugSchema = z
  .string()
  .refine((slug) => isValidPagePath(slug) && !slug.includes('/'), 'Expected a single-segment slug');

/**
 * A slug the app creates itself. Stricter than the one it reads: a directory dropped in by
 * hand keeps working, but a new space never gets a name that two case-insensitive
 * filesystems would disagree about.
 */
export const NewSpaceSlugSchema = SpaceSlugSchema.refine(
  (slug) => /^[a-z0-9][a-z0-9-]*$/.test(slug),
  'Expected a lower-case slug like "engineering" or "team-docs"',
);

/** A unicode emoji, or a `:shortcode:` naming a custom one. Long enough for the longest code. */
export const IconSchema = z.string().min(1).max(40);

// ---------------------------------------------------------------------------
// domain models
// ---------------------------------------------------------------------------

export const FrontmatterSchema = z.object({
  id: PageIdSchema,
  title: z.string().min(1),
  icon: IconSchema.optional(),
  order: z.number().optional(),
  created: IsoDateSchema,
  updated: IsoDateSchema,
});

export const PageSummarySchema = z.object({
  id: PageIdSchema,
  path: PagePathSchema,
  space: SpaceSlugSchema,
  title: z.string(),
  icon: IconSchema.optional(),
  order: z.number().optional(),
  created: IsoDateSchema,
  updated: IsoDateSchema,
  filePath: z.string().min(1),
  hasChildren: z.boolean(),
});

export const PageSchema = PageSummarySchema.extend({
  markdown: z.string(),
  rev: z.string().min(1),
});

export const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    id: PageIdSchema,
    path: PagePathSchema,
    title: z.string(),
    icon: IconSchema.optional(),
    order: z.number().optional(),
    children: z.array(TreeNodeSchema),
  }),
);

export const SpaceSchema = z.object({
  slug: SpaceSlugSchema,
  name: z.string().min(1),
  icon: IconSchema.optional(),
  order: z.number().optional(),
});

/** Contents of a `_space.yml` file: everything about a space except its slug. */
export const SpaceFileSchema = z.object({
  name: z.string().min(1),
  icon: IconSchema.optional(),
  order: z.number().optional(),
});

export const SearchHitSchema = z.object({
  id: PageIdSchema,
  path: PagePathSchema,
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
});

export const RevisionSchema = z.object({
  sha: z.string().min(1),
  author: z.string(),
  email: z.string(),
  date: z.string(),
  message: z.string(),
});

export const GitConflictSchema = z.object({
  files: z.array(z.string()),
  message: z.string(),
  at: z.string(),
});

export const GitStatusSchema = z.object({
  branch: z.string(),
  ahead: z.number().int(),
  behind: z.number().int(),
  dirtyFiles: z.array(z.string()),
  remote: z.string().nullable(),
  lastCommit: RevisionSchema.nullable(),
  conflict: GitConflictSchema.nullable(),
});

export const ConflictFileSchema = z.object({
  file: z.string().min(1),
  path: PagePathSchema.nullable(),
  title: z.string().nullable(),
  local: z.string(),
  remote: z.string(),
  base: z.string(),
  merged: z.string(),
  clean: z.boolean(),
});

export const BacklinkSchema = z.object({
  id: PageIdSchema,
  path: PagePathSchema,
  title: z.string(),
});

export const ErrorCodeSchema = z.enum([
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION',
  'UNAUTHORIZED',
  'GIT_ERROR',
  'INTERNAL',
]);

export const ConflictInfoSchema = z.object({
  markdown: z.string(),
  rev: z.string().min(1),
  updated: IsoDateSchema,
});

export const ErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    info: ConflictInfoSchema.optional(),
  }),
});

// ---------------------------------------------------------------------------
// query-string helpers (everything arrives as a string)
// ---------------------------------------------------------------------------

const boolParam = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === 'true' || value === '1');

const intParam = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

// ---------------------------------------------------------------------------
// request bodies
// ---------------------------------------------------------------------------

/** Sign in. Every session names an account, so the address is always required. */
export const LoginBodySchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1),
});

export const CreateSpaceBodySchema = z.object({
  slug: NewSpaceSlugSchema,
  name: z.string().min(1),
  icon: IconSchema.optional(),
  order: z.number().optional(),
});

export const UpdateSpaceBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    icon: IconSchema.nullable().optional(),
    order: z.number().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const CreatePageBodySchema = z.object({
  path: PagePathSchema,
  title: z.string().min(1),
  markdown: z.string().optional(),
  icon: IconSchema.optional(),
  order: z.number().optional(),
});

export const UpdatePageBodySchema = z
  .object({
    title: z.string().min(1).optional(),
    markdown: z.string().optional(),
    icon: IconSchema.nullable().optional(),
    order: z.number().nullable().optional(),
    path: PagePathSchema.optional(),
    /** The revision the edit started from. The server rejects the save if the file moved on. */
    baseRev: z.string().min(1).optional(),
  })
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'baseRev'),
    'Provide at least one field to update',
  );

/**
 * A commit message the caller wrote. The git log is parsed on separator bytes, so a control
 * character in the message could otherwise forge a whole revision row.
 */
const CommitMessageSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),
    'The message contains control characters',
  );

/** A repo-relative path the conflict UI may write. `.git` is metadata, never content. */
const ConflictFilePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !value.startsWith('/') && !/^[a-zA-Z]:/.test(value), 'Use a repo-relative path')
  .refine(
    (value) =>
      !value
        .replace(/\\/g, '/')
        .split('/')
        .some((segment) => segment === '..' || segment.toLowerCase() === '.git'),
    'That path is not inside the content tree',
  );

export const GitCommitBodySchema = z.object({ message: CommitMessageSchema.optional() });

/** One decision from the conflict UI: the exact text to keep for a file. */
export const GitResolveBodySchema = z.object({
  files: z
    .array(z.object({ file: ConflictFilePathSchema, content: z.string() }))
    .min(1),
  message: CommitMessageSchema.optional(),
});

// ---------------------------------------------------------------------------
// query params
// ---------------------------------------------------------------------------

export const PagesQuerySchema = z.object({ path: PagePathSchema.optional() });

export const DeletePageQuerySchema = z.object({ recursive: boolParam.optional() });

export const SearchQuerySchema = z.object({
  q: z.string().min(1),
  space: SpaceSlugSchema.optional(),
  limit: intParam(1, 200).optional(),
});

export const HistoryQuerySchema = z.object({ limit: intParam(1, 500).optional() });

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

// An anonymous caller gets `ok` alone, so the build and the content directory are optional.
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().optional(),
  contentDir: z.string().optional(),
});

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const SpacesResponseSchema = z.object({ spaces: z.array(SpaceSchema) });
export const SpaceResponseSchema = z.object({ space: SpaceSchema });

export const TreeResponseSchema = z.object({
  spaces: z.array(SpaceSchema.extend({ tree: z.array(TreeNodeSchema) })),
});

export const PageResponseSchema = z.object({ page: PageSchema });
export const PageListResponseSchema = z.object({ pages: z.array(PageSummarySchema) });
export const DeletePageResponseSchema = z.object({ deleted: z.array(PagePathSchema) });

export const SearchResponseSchema = z.object({ hits: z.array(SearchHitSchema) });
export const BacklinksResponseSchema = z.object({ backlinks: z.array(BacklinkSchema) });
export const HistoryResponseSchema = z.object({ revisions: z.array(RevisionSchema) });
export const RevisionContentResponseSchema = z.object({
  markdown: z.string(),
  frontmatter: FrontmatterSchema,
});

export const GitStatusResponseSchema = z.object({ status: GitStatusSchema });
export const GitPullResponseSchema = z.object({
  status: GitStatusSchema,
  pulled: z.number().int(),
});
export const GitPushResponseSchema = z.object({ status: GitStatusSchema, pushed: z.boolean() });
export const GitCommitResponseSchema = z.object({ sha: z.string().nullable() });
export const GitConflictResponseSchema = z.object({
  conflict: GitConflictSchema.nullable(),
  files: z.array(ConflictFileSchema),
});
export const GitResolveResponseSchema = z.object({
  status: GitStatusSchema,
  resolved: z.array(z.string()),
});

export const AssetResponseSchema = z.object({ url: z.string(), path: z.string() });

// ---------------------------------------------------------------------------
// inferred types
// ---------------------------------------------------------------------------

export type FrontmatterInput = z.infer<typeof FrontmatterSchema>;
export type SpaceFile = z.infer<typeof SpaceFileSchema>;

export type LoginBody = z.infer<typeof LoginBodySchema>;
export type CreateSpaceBody = z.infer<typeof CreateSpaceBodySchema>;
export type UpdateSpaceBody = z.infer<typeof UpdateSpaceBodySchema>;
export type CreatePageBody = z.infer<typeof CreatePageBodySchema>;
export type UpdatePageBody = z.infer<typeof UpdatePageBodySchema>;
export type GitCommitBody = z.infer<typeof GitCommitBodySchema>;
export type GitResolveBody = z.infer<typeof GitResolveBodySchema>;

export type PagesQuery = z.infer<typeof PagesQuerySchema>;
export type DeletePageQuery = z.infer<typeof DeletePageQuerySchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type OkResponse = z.infer<typeof OkResponseSchema>;
export type SpacesResponse = z.infer<typeof SpacesResponseSchema>;
export type SpaceResponse = z.infer<typeof SpaceResponseSchema>;
export type TreeResponse = z.infer<typeof TreeResponseSchema>;
export type PageResponse = z.infer<typeof PageResponseSchema>;
export type PageListResponse = z.infer<typeof PageListResponseSchema>;
export type DeletePageResponse = z.infer<typeof DeletePageResponseSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type BacklinksResponse = z.infer<typeof BacklinksResponseSchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
export type RevisionContentResponse = z.infer<typeof RevisionContentResponseSchema>;
export type GitStatusResponse = z.infer<typeof GitStatusResponseSchema>;
export type GitPullResponse = z.infer<typeof GitPullResponseSchema>;
export type GitPushResponse = z.infer<typeof GitPushResponseSchema>;
export type GitCommitResponse = z.infer<typeof GitCommitResponseSchema>;
export type GitConflictResponse = z.infer<typeof GitConflictResponseSchema>;
export type GitResolveResponse = z.infer<typeof GitResolveResponseSchema>;
export type AssetResponse = z.infer<typeof AssetResponseSchema>;

// ---------------------------------------------------------------------------
// parse helper
// ---------------------------------------------------------------------------

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.join('.');
      if (at.length === 0) return issue.message;
      return `${at}: ${issue.message}`;
    })
    .join('; ');
}

/** Validate `data`, or throw a VALIDATION AppError listing every issue. */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, label = 'input'): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw validation(`Invalid ${label} - ${formatIssues(result.error)}`, result.error.issues);
}
