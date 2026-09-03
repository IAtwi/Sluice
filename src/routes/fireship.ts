import type { Route } from '../core/types.js';

/**
 * Fireship (@Fireship), software development.
 * No content rules: every ordinary upload goes to the playlist.
 * Shares its destination playlist with [[salem-zahran]], [[zay-el-ketab]]
 * and [[mokhbir-eqtisadi]].
 *
 * Note: Fireship posts a lot of short-form content. The global Shorts filter excludes it,
 * but if unwanted brief videos still get through, `minDurationMinutes` on this route is
 * the lever.
 */
export const fireship: Route = {
  id: 'fireship',
  label: 'Fireship (@Fireship)',
  channelId: 'UCsBjURrPoezykLs9EqgamOA',
  playlistId: 'PLZTEXTPH8G_0',
  rules: [],
};
