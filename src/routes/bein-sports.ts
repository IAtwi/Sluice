import { titleContains } from '../core/rules.js';
import type { Route } from '../core/types.js';

/**
 * beIN SPORTS (@beINSPORTS), match highlights for four competitions only.
 * Destination: Sluice_Football.
 *
 * The channel posts tennis, news and promos alongside football, so the rule is
 * deliberately narrow: it keys on the competition label beIN puts after the "|"
 * separator, e.g. "ملخص مباراة ريال مدريد ورايو فايكانو | الدوري الإسباني - الجولة 5".
 *
 * titleContains is OR across its terms, so any one term matching is enough.
 *
 * beIN renamed the English league mid-September 2026, dropping "الممتاز":
 *   before: "... | الدوري الإنجليزي الممتاز - الجولة 4"
 *   after:  "... | الدوري الإنجليزي - الجولة 5"
 * Neither string is a substring of the other, so both are listed. Keeping the old form
 * costs nothing and means a revert on beIN's side does not silently stop matching.
 */
export const beinSports: Route = {
  id: 'bein-sports',
  label: 'beIN SPORTS (@beINSPORTS)',
  channelId: 'UCJUCcJUeh0Cz2xyKwkw5Q1w',
  playlistId: 'PLKmUJKFUTrr4',
  rules: [
    titleContains(
      'دوري أبطال أوروبا -',
      'دوري الأمم الأوروبية - الجولة',
      'الدوري الإسباني - الجولة',
      'الدوري الإنجليزي - الجولة',
      'الدوري الإنجليزي الممتاز - الجولة',
      'كأس الاتحاد الإنجليزي -',
    ),
  ],
};
