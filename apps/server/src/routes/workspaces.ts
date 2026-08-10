import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { z } from 'zod';
import type { AccountStore, WorkspaceRecord } from '@tablinum/accounts';
import {
  AddWorkspaceMemberBodySchema,
  CreateWorkspaceBodySchema,
  UpdateWorkspaceBodySchema,
  UpdateWorkspaceMemberBodySchema,
  conflict,
  notFound,
  parseOrThrow,
  validation,
  workspaceExportName,
  workspaceSlugOf,
  type OkResponse,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceMembersResponse,
  type WorkspaceResponse,
  type WorkspacesResponse,
} from '@tablinum/shared';
import {
  requireAccount,
  requireAdmin,
  requireSameSiteNavigation,
  requireWorkspaceAdmin,
} from '../auth.js';
import { API_PREFIX, type RouteContext } from '../context.js';
import { unzipToDirectory, zipDirectory } from '../zip.js';

/**
 * Workspaces.
 *
 * Creating, importing and deleting one is an install-wide action, so it asks for an admin.
 * Renaming a workspace, managing its people and exporting it only ask for an admin of that
 * workspace, because that is what makes belonging to several of them workable.
 */

/** Biggest workspace archive the server will accept or produce. */
export const MAX_WORKSPACE_ZIP_BYTES = 256 * 1024 * 1024;

/** The space a brand new workspace starts with, so the UI is never a dead end. */
const STARTER_SPACE = { slug: 'general', name: 'General' };

const IdParamsSchema = z.object({ id: z.string().min(1) });
const MemberParamsSchema = z.object({ id: z.string().min(1), userId: z.string().min(1) });
const ImportQuerySchema = z.object({ name: z.string().trim().min(1).max(60).optional() });

/** The record behind an id or a slug in the path. */
function recordOf(accounts: AccountStore, idOrSlug: string): WorkspaceRecord {
  const found = accounts.getWorkspace(idOrSlug) ?? accounts.getWorkspaceBySlug(idOrSlug);
  if (found === null) throw notFound(`No workspace called ${idOrSlug}`);
  return found;
}

/** The wire shape. `dir` is a server detail and never leaves the process. */
function toWorkspace(record: WorkspaceRecord): Workspace {
  const { dir: _dir, ...rest } = record;
  return rest;
}

/** Refuse a workspace the caller may not even see, before saying anything else about it. */
function requireVisible(
  ctx: RouteContext,
  request: FastifyRequest,
  record: WorkspaceRecord,
): void {
  const allowed = ctx.workspaces.allowedFor(request);
  if (allowed.some((entry) => entry.id === record.id)) return;
  throw notFound(`No workspace called ${record.slug}`);
}

/** Where a new workspace's repository is created. */
function workspacesRoot(ctx: RouteContext): string {
  return ctx.deps.workspacesDir ?? resolve(ctx.deps.store.contentDir, '..', 'workspaces');
}

/** A directory nothing occupies yet. A deleted workspace leaves its files behind. */
function freeDir(root: string, slug: string): string {
  for (let n = 1; ; n += 1) {
    const candidate = join(root, n === 1 ? slug : `${slug}-${n}`);
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * Zipping a folder usually wraps everything in one directory. Step into it, so an archive
 * made either way lands with the repository at the top.
 */
async function unwrapSingleRoot(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const first = entries[0];
  if (entries.length !== 1 || first === undefined || !first.isDirectory()) return dir;
  if (first.name === '.git') return dir;
  return join(dir, first.name);
}

interface Upload {
  filename: string;
  data: Buffer;
}

async function readArchive(request: FastifyRequest): Promise<{ name: string | null; file: Upload | null }> {
  let name: string | null = null;
  let file: Upload | null = null;

  // The global limit is sized for an attachment; a whole repository is allowed to be bigger.
  for await (const part of request.parts({ limits: { fileSize: MAX_WORKSPACE_ZIP_BYTES } })) {
    if (part.type === 'field') {
      if (part.fieldname === 'name' && typeof part.value === 'string') name = part.value.trim();
      continue;
    }
    if (file !== null) throw validation('Upload exactly one archive per request');
    const data = await part.toBuffer();
    if (part.file.truncated) {
      throw validation(`The archive is larger than the ${MAX_WORKSPACE_ZIP_BYTES} byte limit`);
    }
    file = { filename: part.filename, data };
  }

  return { name, file };
}

/** "handbook.zip" becomes "handbook". */
function nameFromFilename(filename: string): string {
  const stem = filename.replace(/\.zip$/i, '').replace(/[_-]+/g, ' ').trim();
  return stem.length === 0 ? 'Imported workspace' : stem;
}

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { accounts } = ctx.deps;

  app.get(`${API_PREFIX}/workspaces`, async (request): Promise<WorkspacesResponse> => {
    return {
      workspaces: ctx.workspaces.allowedFor(request).map(toWorkspace),
      current: request.workspace.slug,
    };
  });

  app.post(`${API_PREFIX}/workspaces`, async (request, reply): Promise<WorkspaceResponse> => {
    requireAdmin(request);
    const body = parseOrThrow(CreateWorkspaceBodySchema, request.body ?? {}, 'workspace');

    const slug = accounts.freeWorkspaceSlug(body.slug ?? workspaceSlugOf(body.name));
    const dir = freeDir(workspacesRoot(ctx), slug);
    await mkdir(dir, { recursive: true });

    const record = accounts.createWorkspace({
      name: body.name,
      slug,
      dir,
      ...(body.icon === undefined ? {} : { icon: body.icon }),
    });
    const account = request.principal.account;
    if (account !== null) accounts.addMember(record.id, account.id, 'admin');

    const parts = await ctx.workspaces.open(record);
    const space = await parts.store.createSpace(STARTER_SPACE);
    const home = await parts.store.getPageByPath(space.slug);
    await parts.wiring.recordMutation({
      pages: home === null ? [] : [home],
      message: `Create workspace ${record.name}`,
    });

    reply.status(201);
    return { workspace: toWorkspace(record) };
  });

  app.patch(`${API_PREFIX}/workspaces/:id`, async (request): Promise<WorkspaceResponse> => {
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'workspace id');
    const record = recordOf(accounts, id);
    requireVisible(ctx, request, record);
    requireWorkspaceAdmin(accounts, request, record);
    const body = parseOrThrow(UpdateWorkspaceBodySchema, request.body ?? {}, 'workspace patch');
    return { workspace: toWorkspace(accounts.updateWorkspace(record.id, body)) };
  });

  app.delete(`${API_PREFIX}/workspaces/:id`, async (request): Promise<OkResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'workspace id');
    const record = recordOf(accounts, id);
    if (record.id === ctx.workspaces.default.record.id) {
      throw validation('The workspace this server was started with cannot be deleted');
    }
    // Refuses the last workspace, and takes that workspace's agents with it.
    accounts.deleteWorkspace(record.id);
    await ctx.workspaces.release(record.id);
    // The files stay on disk. Removing a repository on an API call is not undoable.
    request.log.info({ dir: record.dir }, 'workspace deleted, its files were left in place');
    return { ok: true };
  });

  app.get(`${API_PREFIX}/workspaces/:id/members`, async (request): Promise<WorkspaceMembersResponse> => {
    // A machine credential has no reason to read the roster of people.
    requireAccount(request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'workspace id');
    const record = recordOf(accounts, id);
    requireVisible(ctx, request, record);

    const members: WorkspaceMember[] = [];
    for (const entry of accounts.listMembers(record.id)) {
      const account = accounts.getUser(entry.userId);
      if (account !== null) members.push({ account, role: entry.role });
    }
    return { members };
  });

  app.post(`${API_PREFIX}/workspaces/:id/members`, async (request): Promise<OkResponse> => {
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'workspace id');
    const record = recordOf(accounts, id);
    requireWorkspaceAdmin(accounts, request, record);
    const body = parseOrThrow(AddWorkspaceMemberBodySchema, request.body ?? {}, 'member');
    accounts.addMember(record.id, body.userId, body.role ?? 'member');
    return { ok: true };
  });

  app.patch(`${API_PREFIX}/workspaces/:id/members/:userId`, async (request): Promise<OkResponse> => {
    const { id, userId } = parseOrThrow(MemberParamsSchema, request.params, 'params');
    const record = recordOf(accounts, id);
    requireWorkspaceAdmin(accounts, request, record);
    const body = parseOrThrow(UpdateWorkspaceMemberBodySchema, request.body ?? {}, 'member patch');
    if (accounts.memberRole(record.id, userId) === null) {
      throw notFound('That person is not in this workspace');
    }
    accounts.addMember(record.id, userId, body.role);
    return { ok: true };
  });

  app.delete(`${API_PREFIX}/workspaces/:id/members/:userId`, async (request): Promise<OkResponse> => {
    const { id, userId } = parseOrThrow(MemberParamsSchema, request.params, 'params');
    const record = recordOf(accounts, id);
    requireWorkspaceAdmin(accounts, request, record);

    const me = request.principal.account;
    if (me !== null && me.id === userId) {
      throw conflict('Removing yourself would lock you out. Ask another admin.');
    }
    const admins = accounts.listMembers(record.id).filter((entry) => entry.role === 'admin');
    if (admins.length === 1 && admins[0]?.userId === userId) {
      throw conflict('A workspace needs at least one admin');
    }

    accounts.removeMember(record.id, userId);
    return { ok: true };
  });

  /** The whole repository as a zip, history included. */
  app.get(`${API_PREFIX}/workspaces/:id/export`, async (request, reply) => {
    // A GET that commits, so a link on another site must not be able to fire it.
    requireSameSiteNavigation(request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'workspace id');
    const record = recordOf(accounts, id);
    requireVisible(ctx, request, record);
    requireWorkspaceAdmin(accounts, request, record);

    const parts = await ctx.workspaces.open(record);
    // Commit first, or the export would miss whatever the last few saves have not committed.
    await parts.git.commit(`Export workspace ${record.name}`);
    // An archive leaves the machine, which is the one thing a private space must never do. The
    // git exclude list is exactly that set, and it names every private space, so it goes too.
    const hidden = new Set(await parts.git.excludedPaths());
    const archive = await zipDirectory(parts.store.contentDir, {
      maxBytes: MAX_WORKSPACE_ZIP_BYTES,
      skip: (rel) => rel === '.git/info/exclude' || hidden.has(rel),
    });

    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${workspaceExportName(record.slug)}"`)
      .header('content-length', String(archive.byteLength))
      .send(archive);
  });

  /** The other half: a zip made by an export becomes a workspace here. */
  app.post(`${API_PREFIX}/workspaces/import`, async (request, reply): Promise<WorkspaceResponse> => {
    requireAdmin(request);
    if (!request.isMultipart()) throw validation('Expected a multipart/form-data upload');

    const query = parseOrThrow(ImportQuerySchema, request.query, 'query');
    const upload = await readArchive(request);
    if (upload.file === null) throw validation('The upload contains no archive');

    const name = upload.name ?? query.name ?? nameFromFilename(upload.file.filename);
    const slug = accounts.freeWorkspaceSlug(workspaceSlugOf(name));
    const holder = freeDir(workspacesRoot(ctx), slug);
    await mkdir(holder, { recursive: true });
    await unzipToDirectory(upload.file.data, holder);
    const dir = await unwrapSingleRoot(holder);

    const record = accounts.createWorkspace({ name, slug, dir });
    const account = request.principal.account;
    if (account !== null) accounts.addMember(record.id, account.id, 'admin');

    // Opening it initializes the repo when the archive carried no .git, and builds the index.
    await ctx.workspaces.open(record);

    reply.status(201);
    return { workspace: toWorkspace(record) };
  });
}
