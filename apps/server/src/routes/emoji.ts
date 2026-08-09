import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { z } from 'zod';
import {
  CustomEmojiIdSchema,
  MAX_CUSTOM_EMOJI_BYTES,
  ShortcodeSchema,
  notFound,
  parseOrThrow,
  validation,
  type CustomEmojiListResponse,
  type CustomEmojiResponse,
  type OkResponse,
} from '@tablinum/shared';
import { requireAccount } from '../auth.js';
import { API_PREFIX, type RouteContext } from '../context.js';

const EmojiIdParamsSchema = z.object({ id: CustomEmojiIdSchema });
const EmojiShortcodeParamsSchema = z.object({ shortcode: ShortcodeSchema });

/** The bytes behind one shortcode rarely change, and a stale one is a wrong picture, not a bug. */
const EMOJI_CACHE = 'private, max-age=300';

interface EmojiUpload {
  shortcode: string;
  bytes: Buffer;
}

/** Read the name and the single image part of a multipart custom emoji upload. */
async function readUpload(request: FastifyRequest): Promise<EmojiUpload> {
  if (!request.isMultipart()) throw validation('Expected a multipart/form-data upload');

  let shortcode = '';
  let bytes: Buffer | null = null;
  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (part.fieldname === 'shortcode' && typeof part.value === 'string') shortcode = part.value;
      continue;
    }
    if (bytes !== null) throw validation('Upload exactly one image per request');
    const body = await part.toBuffer();
    if (part.file.truncated) throw validation('That image is too large for a custom emoji');
    bytes = body;
  }

  if (bytes === null) throw validation('The upload contains no file part');
  if (bytes.length > MAX_CUSTOM_EMOJI_BYTES) {
    throw validation(`A custom emoji must be ${MAX_CUSTOM_EMOJI_BYTES} bytes or smaller`);
  }
  return { shortcode: parseOrThrow(ShortcodeSchema, shortcode, 'shortcode'), bytes };
}

export function registerEmojiRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { accounts } = ctx.deps;

  /** Everyone signed in may read the set: a page renders whatever shortcodes it holds. */
  app.get(`${API_PREFIX}/emoji`, async (): Promise<CustomEmojiListResponse> => {
    return { emoji: accounts.listCustomEmoji() };
  });

  app.post(`${API_PREFIX}/emoji`, async (request): Promise<CustomEmojiResponse> => {
    const me = requireAccount(request);
    const upload = await readUpload(request);
    const emoji = accounts.createCustomEmoji({
      shortcode: upload.shortcode,
      userId: me.id,
      bytes: upload.bytes,
    });
    return { emoji };
  });

  app.get(`${API_PREFIX}/emoji/:shortcode/image`, async (request, reply): Promise<FastifyReply> => {
    const { shortcode } = parseOrThrow(EmojiShortcodeParamsSchema, request.params, 'shortcode');
    const image = accounts.getCustomEmojiImage(shortcode);
    if (image === null) throw notFound(`No custom emoji named :${shortcode}:`);

    return reply
      .type(image.mime)
      .header('Cache-Control', EMOJI_CACHE)
      .header('ETag', `"${image.rev}"`)
      .send(image.bytes);
  });

  /** The uploader may remove their own; an admin may remove anybody's. */
  app.delete(`${API_PREFIX}/emoji/:id`, async (request): Promise<OkResponse> => {
    const me = requireAccount(request);
    const { id } = parseOrThrow(EmojiIdParamsSchema, request.params, 'emoji id');
    accounts.deleteCustomEmoji(id, { userId: me.id, admin: request.principal.admin });
    return { ok: true };
  });
}
