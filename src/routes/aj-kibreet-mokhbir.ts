import { titleContains } from '../core/rules.js';
import type { Route } from '../core/types.js';

/**
 * AJ+ كبريت (@AJpluskibreet), the "المُخبر الاقتصادي+" economics series only.
 * Destination: Sluice_WL.
 *
 * The same channel is also routed by [[aj-kibreet-daheeh]] to a different playlist.
 * Both routes share one RSS fetch per run and keep separate state.
 *
 * The channel is inconsistent about tashkeel across titles, so the rule is matched
 * through normalizeForMatch(), which strips diacritics from both sides.
 */
export const ajKibreetMokhbir: Route = {
  id: 'aj-kibreet-mokhbir',
  label: 'AJ+ Kibreet, Mokhbir Eqtisadi (@AJpluskibreet)',
  channelId: 'UC-4KnPMmZzwAzW7SbVATUZQ',
  playlistId: 'PLZTEXTPH8G_0',
  rules: [titleContains('المُخبر الاقتصادي')],
};
