import { z } from 'zod';
import { IsoDateSchema, PageIdSchema } from './schemas.js';

/**
 * Favorites.
 *
 * A favorite is one person's pin, not a property of the page, so it lives in the account
 * database beside the comments and never in the repo. Two people in one workspace pin
 * different pages, and neither pin travels to a git remote.
 *
 * The record holds only the page id. The browser already has the tree, so it resolves the
 * title, the icon and the path from there; a favorite whose page was deleted simply stops
 * resolving and drops out of the bucket.
 */

/** How many pages one person may pin in one workspace. */
export const MAX_FAVORITES = 200;

export const FavoriteSchema = z.object({
  pageId: PageIdSchema,
  created: IsoDateSchema,
});

export const FavoritesResponseSchema = z.object({ favorites: z.array(FavoriteSchema) });
export const FavoriteResponseSchema = z.object({ favorite: FavoriteSchema });

export type Favorite = z.infer<typeof FavoriteSchema>;
export type FavoritesResponse = z.infer<typeof FavoritesResponseSchema>;
export type FavoriteResponse = z.infer<typeof FavoriteResponseSchema>;
