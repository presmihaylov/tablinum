import type { FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { z } from 'zod';
import { MAX_AVATAR_BYTES, validation } from '@tablinum/shared';
import type { Avatar } from '@tablinum/accounts';

export const AvatarQuerySchema = z.object({ v: z.string().optional() });

/** An avatar is addressed by its rev, so a hit on that URL can never be stale. */
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';

/** Read the single image part of a multipart avatar upload. */
export async function readAvatarUpload(
  request: FastifyRequest,
): Promise<{ mime: string; bytes: Buffer }> {
  if (!request.isMultipart()) throw validation('Expected a multipart/form-data upload');

  let picked: { mime: string; bytes: Buffer } | null = null;
  for await (const part of request.parts()) {
    if (part.type === 'field') continue;
    if (picked !== null) throw validation('Upload exactly one image per request');
    const bytes = await part.toBuffer();
    if (part.file.truncated) throw validation('That image is too large for an avatar');
    picked = { mime: part.mimetype, bytes };
  }

  if (picked === null) throw validation('The upload contains no file part');
  if (picked.bytes.length > MAX_AVATAR_BYTES) {
    throw validation(`An avatar must be ${MAX_AVATAR_BYTES} bytes or smaller`);
  }
  return picked;
}

/** Send a stored avatar. Without the matching rev the answer stays fresh, or an upload is never seen. */
export function sendAvatar(reply: FastifyReply, avatar: Avatar, wanted: string | undefined): FastifyReply {
  const cache = wanted === avatar.rev ? IMMUTABLE_CACHE : 'private, no-cache';
  return reply
    .type(avatar.mime)
    .header('Cache-Control', cache)
    .header('ETag', `"${avatar.rev}"`)
    .send(avatar.bytes);
}
