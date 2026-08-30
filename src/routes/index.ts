import type { Route } from '../core/types.js';
import { ken } from './ken.js';

/**
 * Every route Sluice runs. A route is one channel, one destination playlist, one rule set.
 * The same channel may appear more than once with different rules and playlists.
 */
export const routes: Route[] = [ken];
