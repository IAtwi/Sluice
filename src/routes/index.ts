import type { Route } from '../core/types.js';
import { fireship } from './fireship.js';
import { ken } from './ken.js';
import { mokhbirEqtisadi } from './mokhbir-eqtisadi.js';
import { salemZahran } from './salem-zahran.js';
import { sebastianLague } from './sebastian-lague.js';
import { veritasium } from './veritasium.js';
import { zayElKetab } from './zay-el-ketab.js';

/**
 * Every route Sluice runs. A route is one channel, one destination playlist, one rule set.
 *
 * The same channel may appear more than once with different rules and playlists, and several
 * channels may share one playlist. Each route keeps its own state and its own log folder, and
 * the playlist membership check before every insert keeps shared playlists duplicate free.
 */
export const routes: Route[] = [
  ken,
  salemZahran,
  zayElKetab,
  mokhbirEqtisadi,
  fireship,
  veritasium,
  sebastianLague,
];
