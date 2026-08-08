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

export const IconSchema = z.string().min(1).max(16);

export const TagsSchema = z.array(z.string().min(1).max(64));

export const PropValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export const PropsSchema = z.record(z.string().min(1), PropValueSchema);

// ---------------------------------------------------------------------------
// domain models
// ---------------------------------------------------------------------------

export const FrontmatterSchema = z.object({
  id: PageIdSchema,
  title: z.string().min(1),
  icon: IconSchema.optional(),
  tags: TagsSchema.optional(),
  order: z.number().optional(),
  created: IsoDateSchema,
  updated: IsoDateSchema,
  props: PropsSchema.optional(),
});

export const PageSummarySchema = z.object({
  id: PageIdSchema,
  path: PagePathSchema,
  space: SpaceSlugSchema,
  title: z.string(),
  icon: IconSchema.optional(),
  tags: TagsSchema,
  order: z.number().optional(),
  created: IsoDateSchema,
  updated: IsoDateSchema,
  props: PropsSchema,
  filePath: z.string().min(1),
  hasChildren: z.boolean(),
});

export const PageSchema = PageSummarySchema.extend({
  markdown: z.string(),
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

export const GitStatusSchema = z.object({
  branch: z.string(),
  ahead: z.number().int(),
  behind: z.number().int(),
  dirtyFiles: z.array(z.string()),
  remote: z.string().nullable(),
  lastCommit: RevisionSchema.nullable(),
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

export const ErrorBodySchema = z.object({
  error: z.object({ code: ErrorCodeSchema, message: z.string() }),
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

export const LoginBodySchema = z.object({ password: z.string().min(1) });

export const CreateSpaceBodySchema = z.object({
  slug: NewSpaceSlugSchema,
  name: z.string().min(1),
  icon: IconSchema.optional(),
  order: z.number().optional(),
});

export const CreatePageBodySchema = z.object({
  path: PagePathSchema,
  title: z.string().min(1),
  markdown: z.string().optional(),
  icon: IconSchema.optional(),
  tags: TagsSchema.optional(),
  props: PropsSchema.optional(),
  order: z.number().optional(),
});

export const UpdatePageBodySchema = z
  .object({
    title: z.string().min(1).optional(),
    markdown: z.string().optional(),
    icon: IconSchema.nullable().optional(),
    tags: TagsSchema.optional(),
    props: PropsSchema.optional(),
    order: z.number().nullable().optional(),
    path: PagePathSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const GitCommitBodySchema = z.object({ message: z.string().min(1).optional() });

// ---------------------------------------------------------------------------
// query params
// ---------------------------------------------------------------------------

export const PagesQuerySchema = z.object({ path: PagePathSchema.optional() });

export const DeletePageQuerySchema = z.object({ recursive: boolParam.optional() });

export const SearchQuerySchema = z.object({
  q: z.string().min(1),
  space: SpaceSlugSchema.optional(),
  tag: z.string().min(1).optional(),
  limit: intParam(1, 200).optional(),
});

export const HistoryQuerySchema = z.object({ limit: intParam(1, 500).optional() });

export const ViewsQuerySchema = z.object({
  dir: PagePathSchema,
  /** Comma-separated `key:value` filters over frontmatter props. */
  where: z.string().optional(),
  sort: z.string().min(1).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

/** Parse the `where=k:v,k2:v2` filter of GET /api/v1/views. */
export function parseWhere(where: string | undefined): Record<string, string> {
  if (!where) return {};
  const filters: Record<string, string> = {};
  for (const clause of where.split(',')) {
    const separator = clause.indexOf(':');
    if (separator <= 0) continue;
    const key = clause.slice(0, separator).trim();
    const value = clause.slice(separator + 1).trim();
    if (key.length > 0) filters[key] = value;
  }
  return filters;
}

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  contentDir: z.string(),
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

export const ViewsResponseSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(PageSummarySchema),
});

export const GitStatusResponseSchema = z.object({ status: GitStatusSchema });
export const GitPullResponseSchema = z.object({
  status: GitStatusSchema,
  pulled: z.number().int(),
});
export const GitPushResponseSchema = z.object({ status: GitStatusSchema, pushed: z.boolean() });
export const GitCommitResponseSchema = z.object({ sha: z.string().nullable() });

export const AssetResponseSchema = z.object({ url: z.string(), path: z.string() });

// ---------------------------------------------------------------------------
// inferred types
// ---------------------------------------------------------------------------

export type FrontmatterInput = z.infer<typeof FrontmatterSchema>;
export type SpaceFile = z.infer<typeof SpaceFileSchema>;

export type LoginBody = z.infer<typeof LoginBodySchema>;
export type CreateSpaceBody = z.infer<typeof CreateSpaceBodySchema>;
export type CreatePageBody = z.infer<typeof CreatePageBodySchema>;
export type UpdatePageBody = z.infer<typeof UpdatePageBodySchema>;
export type GitCommitBody = z.infer<typeof GitCommitBodySchema>;

export type PagesQuery = z.infer<typeof PagesQuerySchema>;
export type DeletePageQuery = z.infer<typeof DeletePageQuerySchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
export type ViewsQuery = z.infer<typeof ViewsQuerySchema>;

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
export type ViewsResponse = z.infer<typeof ViewsResponseSchema>;
export type GitStatusResponse = z.infer<typeof GitStatusResponseSchema>;
export type GitPullResponse = z.infer<typeof GitPullResponseSchema>;
export type GitPushResponse = z.infer<typeof GitPushResponseSchema>;
export type GitCommitResponse = z.infer<typeof GitCommitResponseSchema>;
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
