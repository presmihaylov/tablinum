import { z } from 'zod';
import { newUlid } from './ids.js';
import { LIVE_COLORS } from './live.js';
import { IsoDateSchema } from './schemas.js';

/**
 * Accounts.
 *
 * Every person who reaches the web UI has one: a browser session always names somebody, so an
 * edit, a mention and a presence chip all have a person behind them. Machines are the exception
 * and use a bearer token instead: the static API tokens and the per-agent `gda_` tokens.
 */

/** Prefix of a user id, in the style of the page ids. */
export const USER_ID_PREFIX = 'us_';

/** Prefix of an invite id. */
export const INVITE_ID_PREFIX = 'iv_';

const USER_ID_RE = /^us_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const INVITE_ID_RE = /^iv_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export const isUserId = (value: unknown): value is string =>
  typeof value === 'string' && USER_ID_RE.test(value);

export const isInviteId = (value: unknown): value is string =>
  typeof value === 'string' && INVITE_ID_RE.test(value);

/** Shortest password the server accepts. Long beats clever, so there is no character rule. */
export const MIN_PASSWORD_LENGTH = 10;

/** Biggest avatar the server stores. Anything larger is a photo, not an avatar. */
export const MAX_AVATAR_BYTES = 512 * 1024;

/** Image types an avatar may use. Everything else is refused before it reaches the database. */
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** How long an invite link stays usable when the caller names no lifetime. */
export const DEFAULT_INVITE_DAYS = 14;

/**
 * `admin` can invite people, change roles and remove accounts. `member` can read and write
 * every page. There is no per-page permission: the content is one git repo.
 */
export const AccountRoleSchema = z.enum(['admin', 'member']);
export type AccountRole = z.infer<typeof AccountRoleSchema>;

export const UserIdSchema = z.string().refine(isUserId, 'Expected a user id like "us_<ULID>"');
export const InviteIdSchema = z.string().refine(isInviteId, 'Expected an invite id like "iv_<ULID>"');

export const EmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Expected an email address')
  .transform((value) => value.toLowerCase());

export const DisplayNameSchema = z.string().trim().min(1).max(40);

export const PasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);

export const AccountSchema = z.object({
  id: UserIdSchema,
  email: z.string(),
  name: z.string(),
  /** The `@handle` used to mention this person. Set once, then never changed. */
  handle: z.string(),
  role: AccountRoleSchema,
  color: z.string(),
  /**
   * Changes on every avatar upload, so `/users/<id>/avatar?v=<rev>` is safe to cache forever.
   * Null when the person has no avatar and the UI must draw initials instead.
   */
  avatarRev: z.string().nullable(),
  disabled: z.boolean(),
  created: IsoDateSchema,
  updated: IsoDateSchema,
});

export const InviteSchema = z.object({
  id: InviteIdSchema,
  /** Set when the invite is pinned to one address; null when anyone with the link may use it. */
  email: z.string().nullable(),
  role: AccountRoleSchema,
  /** The workspace the invited person joins. Null only for a link made before workspaces. */
  workspaceId: z.string().nullable(),
  createdBy: z.string().nullable(),
  created: IsoDateSchema,
  expires: IsoDateSchema,
  acceptedBy: z.string().nullable(),
  accepted: IsoDateSchema.nullable(),
  revoked: z.boolean(),
});

// ---------------------------------------------------------------------------
// request bodies
// ---------------------------------------------------------------------------

export const SetupBodySchema = z.object({
  email: EmailSchema,
  name: DisplayNameSchema,
  password: PasswordSchema,
});

export const RegisterBodySchema = z.object({
  token: z.string().min(8).max(200),
  /** Ignored when the invite is pinned to an address, so a link cannot be redirected. */
  email: EmailSchema.optional(),
  name: DisplayNameSchema,
  password: PasswordSchema,
});

export const UpdateMeBodySchema = z
  .object({
    name: DisplayNameSchema.optional(),
    color: z.string().min(1).max(24).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const ChangePasswordBodySchema = z.object({
  current: z.string().min(1).max(200),
  next: PasswordSchema,
});

export const CreateInviteBodySchema = z.object({
  email: EmailSchema.optional(),
  role: AccountRoleSchema.optional(),
  expiresInDays: z.coerce.number().int().min(1).max(90).optional(),
});

export const UpdateUserBodySchema = z
  .object({
    name: DisplayNameSchema.optional(),
    role: AccountRoleSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

export const AuthStateResponseSchema = z.object({
  /** True while nobody has claimed the server, so the next visitor creates the first admin. */
  setupRequired: z.boolean(),
  user: AccountSchema.nullable(),
});

export const MeResponseSchema = z.object({ user: AccountSchema.nullable() });

/** What sign-in, sign-up and first-time setup all return. Every one of them names an account. */
export const AuthResponseSchema = z.object({
  ok: z.literal(true),
  user: AccountSchema,
});

export const UsersResponseSchema = z.object({ users: z.array(AccountSchema) });
export const UserResponseSchema = z.object({ user: AccountSchema });
export const InvitesResponseSchema = z.object({ invites: z.array(InviteSchema) });

export const InviteResponseSchema = z.object({
  invite: InviteSchema,
  /** The full link to send. The token appears here once and is never readable again. */
  url: z.string().min(1),
});

/** What the sign-up screen may learn before anybody has proved who they are. */
export const InvitePreviewResponseSchema = z.object({
  email: z.string().nullable(),
  role: AccountRoleSchema,
  expires: IsoDateSchema,
  /** Who sent the invite, for the "X invited you" line. Null when the sender is gone. */
  invitedBy: z.string().nullable(),
});

export const AvatarResponseSchema = z.object({ url: z.string().min(1), rev: z.string().min(1) });

// ---------------------------------------------------------------------------
// inferred types
// ---------------------------------------------------------------------------

export type Account = z.infer<typeof AccountSchema>;
export type Invite = z.infer<typeof InviteSchema>;

export type SetupBody = z.infer<typeof SetupBodySchema>;
export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;
export type CreateInviteBody = z.infer<typeof CreateInviteBodySchema>;
export type UpdateUserBody = z.infer<typeof UpdateUserBodySchema>;

export type AuthStateResponse = z.infer<typeof AuthStateResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type UsersResponse = z.infer<typeof UsersResponseSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type InvitesResponse = z.infer<typeof InvitesResponseSchema>;
export type InviteResponse = z.infer<typeof InviteResponseSchema>;
export type InvitePreviewResponse = z.infer<typeof InvitePreviewResponseSchema>;
export type AvatarResponse = z.infer<typeof AvatarResponseSchema>;

export const newUserId = (now?: number): string => USER_ID_PREFIX + newUlid(now);
export const newInviteId = (now?: number): string => INVITE_ID_PREFIX + newUlid(now);

/**
 * A presence colour derived from the id, so the same person is the same colour in every
 * browser without the colour ever being stored by hand.
 */
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return LIVE_COLORS[hash % LIVE_COLORS.length] ?? LIVE_COLORS[0];
}

/** Up to two letters for the avatar placeholder: "Ada Lovelace" becomes "AL". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? words[words.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** Where a person's avatar is served from. `rev` busts the cache after an upload. */
export function avatarUrl(id: string, rev: string): string {
  return `/api/v1/users/${encodeURIComponent(id)}/avatar?v=${encodeURIComponent(rev)}`;
}

/** The link an invited person opens. `origin` is the browser's, so no base URL is configured. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}`;
}
