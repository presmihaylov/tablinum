import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { z } from 'zod';
import {
  ASSETS_DIR,
  DIAGRAM_EXT,
  PageIdSchema,
  assetRelPath,
  assetUrl,
  isDiagramPath,
  notFound,
  parseOrThrow,
  validation,
  type AssetResponse,
} from '@tablinum/shared';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';

/** Hard ceiling for one attachment. Also enforced by the multipart parser itself. */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const AssetQuerySchema = z.object({ pageId: z.string().min(1).optional() });

interface UploadedFile {
  filename: string;
  data: Buffer;
}

/** `.excalidraw.svg` is two extensions, so `extname` would leave `-2` in the middle of it. */
function suffixOf(filename: string): string {
  if (isDiagramPath(filename)) return filename.slice(-DIAGRAM_EXT.length);
  return extname(filename);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Never overwrite an existing attachment: `logo.png` becomes `logo-2.png`. */
async function freeFilename(dir: string, filename: string): Promise<string> {
  const ext = suffixOf(filename);
  const stem = basename(filename, ext);
  let candidate = filename;
  for (let n = 2; await exists(join(dir, candidate)); n += 1) {
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

async function readUpload(
  request: FastifyRequest,
): Promise<{ pageId: string | null; replace: boolean; file: UploadedFile | null }> {
  let pageId: string | null = null;
  let replace = false;
  let file: UploadedFile | null = null;

  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (part.fieldname === 'pageId' && typeof part.value === 'string') {
        pageId = part.value.trim();
      }
      if (part.fieldname === 'replace' && part.value === 'true') replace = true;
      continue;
    }
    if (file !== null) throw validation('Upload exactly one file per request');
    const data = await part.toBuffer();
    if (part.file.truncated) {
      throw validation(`Attachment is larger than the ${MAX_ASSET_BYTES} byte limit`);
    }
    file = { filename: part.filename, data };
  }

  return { pageId, replace, file };
}

export function registerAssetRoutes(app: FastifyInstance, ctx: RouteContext): void {
  // Attachment URLs are written into committed markdown, so they carry no workspace: the
  // caller's own workspace decides which directory the file is read from.
  app.get(`/${ASSETS_DIR}/*`, async (request, reply) => {
    const { store } = await partsOf(ctx, request);
    const rel = (request.params as Record<string, string>)['*'] ?? '';
    if (rel.length === 0 || rel.includes('..')) throw notFound('No such attachment');
    return reply.sendFile(rel, join(store.contentDir, ASSETS_DIR));
  });

  app.post(`${API_PREFIX}/assets`, async (request): Promise<AssetResponse> => {
    const { store, wiring } = await partsOf(ctx, request);
    if (!request.isMultipart()) {
      throw validation('Expected a multipart/form-data upload');
    }

    const query = parseOrThrow(AssetQuerySchema, request.query, 'query');
    const upload = await readUpload(request);

    const pageId = parseOrThrow(
      PageIdSchema,
      upload.pageId ?? query.pageId,
      'pageId field',
    );
    if (upload.file === null) throw validation('The upload contains no file part');

    const page = await store.getPageById(pageId);
    if (page === null) throw notFound(`No page with id ${pageId}`);

    // assetRelPath() strips any directory component and rejects unsafe characters.
    const safeRel = assetRelPath(page.id, upload.file.filename);
    const safeName = safeRel.slice(safeRel.lastIndexOf('/') + 1);

    const dir = join(store.contentDir, ASSETS_DIR, page.id);
    await mkdir(dir, { recursive: true });
    // `replace` is how a diagram saves over its own scene file. Without it every save would
    // leave a new `-2`, `-3` copy behind and the markdown would have to change every time.
    const filename = upload.replace ? safeName : await freeFilename(dir, safeName);
    const relPath = assetRelPath(page.id, filename);

    const target = join(store.contentDir, relPath);
    const replaced = upload.replace && (await exists(target));
    await writeFile(target, upload.file.data);

    await wiring.recordMutation({
      files: [relPath],
      message: replaced
        ? `Update attachment ${filename} on ${page.path}`
        : `Add attachment ${filename} to ${page.path}`,
    });

    return { url: assetUrl(page.id, filename), path: relPath };
  });
}
