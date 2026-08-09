import { z } from 'zod';
import { AccountRoleSchema, AccountSchema } from './accounts.js';
import { newUlid, slugify } from './ids.js';
import { IconSchema, IsoDateSchema } from './schemas.js';

/**
 * Workspaces.
 *
 * A workspace is the top level of tablinum, above spaces. Each one owns a git repository of
 * its own, so its spaces, pages, attachments, search index and agents are separate from every
 * other workspace. A person can belong to many of them and switches between them in the UI.
 *
 * A whole workspace travels as a zip of its repository, so exporting one and importing it into
 * another tablinum keeps every page and its full history.
 */

/** Prefix of a workspace id, in the style of the page, user and agent ids. */
export const WORKSPACE_ID_PREFIX = 'ws_';

/** Header that names the workspace a request is about. */
export const WORKSPACE_HEADER = 'x-tablinum-workspace';

/** Query parameter with the same meaning, for links and for the websocket upgrade. */
export const WORKSPACE_QUERY = 'workspace';

/**
 * Cookie with the same meaning. The browser fetches an attachment straight from the markdown
 * it renders, so those requests carry no header and no query: the cookie is what tells the
 * server which workspace the image belongs to. It is not a credential.
 */
export const WORKSPACE_COOKIE = 'tablinum_workspace';

/** Slug of the workspace every install starts with. */
export const DEFAULT_WORKSPACE_SLUG = 'main';

/** Name of the workspace every install starts with. */
export const DEFAULT_WORKSPACE_NAME = 'Main';

/** Longest slug a workspace may carry. It is a directory name and a header value. */
export const MAX_WORKSPACE_SLUG_LENGTH = 40;

const WORKSPACE_ID_RE = /^ws_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const WORKSPACE_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export const isWorkspaceId = (value: unknown): value is string =>
  typeof value === 'string' && WORKSPACE_ID_RE.test(value);

export const WorkspaceIdSchema = z
  .string()
  .refine(isWorkspaceId, 'Expected a workspace id like "ws_<ULID>"');

/**
 * Lower case, no slashes and no dots: the slug is a directory name on two case-insensitive
 * filesystems as well as a header value.
 */
export const WorkspaceSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_WORKSPACE_SLUG_LENGTH)
  .refine(
    (slug) => WORKSPACE_SLUG_RE.test(slug),
    'Expected a lower-case slug like "engineering" or "team-docs"',
  );

export const WorkspaceNameSchema = z.string().trim().min(1).max(60);

/** `admin` may rename the workspace, add people and delete it. `member` reads and writes pages. */
export const WorkspaceRoleSchema = AccountRoleSchema;
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const WorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  slug: WorkspaceSlugSchema,
  name: z.string(),
  icon: IconSchema.optional(),
  created: IsoDateSchema,
  updated: IsoDateSchema,
});

export const WorkspaceMemberSchema = z.object({
  account: AccountSchema,
  role: WorkspaceRoleSchema,
});

// ---------------------------------------------------------------------------
// request bodies
// ---------------------------------------------------------------------------

export const CreateWorkspaceBodySchema = z.object({
  name: WorkspaceNameSchema,
  /** Derived from the name when it is absent. */
  slug: WorkspaceSlugSchema.optional(),
  icon: IconSchema.optional(),
});

export const UpdateWorkspaceBodySchema = z
  .object({
    name: WorkspaceNameSchema.optional(),
    slug: WorkspaceSlugSchema.optional(),
    icon: IconSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const AddWorkspaceMemberBodySchema = z.object({
  userId: z.string().min(1),
  role: WorkspaceRoleSchema.optional(),
});

export const UpdateWorkspaceMemberBodySchema = z.object({ role: WorkspaceRoleSchema });

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

export const WorkspacesResponseSchema = z.object({
  workspaces: z.array(WorkspaceSchema),
  /** Slug the server used for this request, so a client with no choice stored knows where it is. */
  current: WorkspaceSlugSchema,
});

export const WorkspaceResponseSchema = z.object({ workspace: WorkspaceSchema });

export const WorkspaceMembersResponseSchema = z.object({
  members: z.array(WorkspaceMemberSchema),
});

// ---------------------------------------------------------------------------
// inferred types
// ---------------------------------------------------------------------------

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBodySchema>;
export type UpdateWorkspaceBody = z.infer<typeof UpdateWorkspaceBodySchema>;
export type AddWorkspaceMemberBody = z.infer<typeof AddWorkspaceMemberBodySchema>;
export type UpdateWorkspaceMemberBody = z.infer<typeof UpdateWorkspaceMemberBodySchema>;
export type WorkspacesResponse = z.infer<typeof WorkspacesResponseSchema>;
export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;
export type WorkspaceMembersResponse = z.infer<typeof WorkspaceMembersResponseSchema>;

export const newWorkspaceId = (now?: number): string => WORKSPACE_ID_PREFIX + newUlid(now);

/** A slug for a workspace name. Falls back to a stable word rather than an empty string. */
export function workspaceSlugOf(name: string): string {
  const slug = slugify(name).slice(0, MAX_WORKSPACE_SLUG_LENGTH).replace(/-+$/g, '');
  return slug.length === 0 ? 'workspace' : slug;
}

/** Filename an export downloads as. */
export function workspaceExportName(slug: string): string {
  return `${slug}.zip`;
}
