import type { Route } from '../core/types.js';
import { ajKibreetDaheeh } from './aj-kibreet-daheeh.js';
import { ajKibreetMokhbir } from './aj-kibreet-mokhbir.js';
import { beinSports } from './bein-sports.js';
import { cleoAbram } from './cleo-abram.js';
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
 * The same channel may appear more than once with different rules and playlists (see the two
 * AJ+ Kibreet routes), and several channels may share one playlist. Each route keeps its own
 * state key and log folder, one RSS fetch is shared per channel per run, and the playlist
 * membership check before every insert keeps shared playlists duplicate free.
 */
export const routes: Route[] = [
  // Sluice_CR
  ken,
  // Sluice_WL
  salemZahran,
  zayElKetab,
  mokhbirEqtisadi,
  fireship,
  ajKibreetMokhbir,
  // Sluice_Learning
  veritasium,
  sebastianLague,
  cleoAbram,
  ajKibreetDaheeh,
  // Sluice_Football
  beinSports,
];
