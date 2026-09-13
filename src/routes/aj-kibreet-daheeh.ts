import { titleContains } from '../core/rules.js';
import type { Route } from '../core/types.js';

/**
 * AJ+ كبريت (@AJpluskibreet), the "الدحيح" series only.
 * Destination: Sluice_Learning.
 *
 * Same channel as [[aj-kibreet-mokhbir]], different rule and different playlist.
 */
export const ajKibreetDaheeh: Route = {
  id: 'aj-kibreet-daheeh',
  label: 'AJ+ Kibreet, Al-Daheeh (@AJpluskibreet)',
  channelId: 'UC-4KnPMmZzwAzW7SbVATUZQ',
  playlistId: 'PLRCZ9kQPHIRY',
  rules: [titleContains('الدحيح')],
};
