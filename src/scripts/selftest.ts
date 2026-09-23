import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG } from '../config.js';
import { decodeXml, parseFeed } from '../core/feed.js';
import { checkLiveStatus, checkRules, checkShortsAndDuration, formatDuration } from '../core/filters.js';
import { dateStamp, fullStamp, Logger, pruneOldLogs } from '../core/logger.js';
import { anyOf, normalizeForMatch, not, titleContains, titleExcludes } from '../core/rules.js';
import { markDecided } from '../core/state.js';
import type { Route, RouteState, Video } from '../core/types.js';
import { parseIsoDuration } from '../core/youtube.js';

/**
 * Offline verification of everything that does not need network or credentials:
 * feed parsing, rules, filters, state and logging. Run with `npm run selftest`.
 */
let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}\n         expected ${e}\n         actual   ${a}`);
    console.log(`  FAIL ${name}  expected ${e}, got ${a}`);
  }
}

function video(over: Partial<Video> = {}): Video {
  return {
    id: 'vid00000001', title: 'Sample', description: '', channelId: 'UC1', channelTitle: 'Ken',
    publishedAt: '2026-08-30T15:00:02+00:00', durationSeconds: 720, liveStatus: 'none',
    wasLiveBroadcast: false, url: 'https://www.youtube.com/watch?v=vid00000001', ...over,
  };
}
const route = (over: Partial<Route> = {}): Route =>
  ({ id: 'r', channelId: 'UC1', playlistId: 'PL1', rules: [], ...over });

console.log('\nfeed parsing');
const xml = readFileSync(join('fixtures', 'UCiFOL6V9KbvxfXvzdFSsqCw.xml'), 'utf8');
const entries = parseFeed(xml);
check('entry count', entries.length, 5);
check('first video id', entries[0]?.videoId, 'I4CsWt-lp08');
check('first title', entries[0]?.title, 'Minion Giant');
check('first published', entries[0]?.publishedAt, '2026-08-30T15:00:02+00:00');
check('entry title not media:title', entries[3]?.title, 'comments & creators were right');
check('empty feed is safe', parseFeed('<feed></feed>').length, 0);
check('decode entities', decodeXml('a &amp;lt; b &quot;q&quot; &#39;x&#39;'), 'a &lt; b "q" \'x\'');

console.log('\niso 8601 durations');
check('PT12M30S', parseIsoDuration('PT12M30S'), 750);
check('PT1H2M3S', parseIsoDuration('PT1H2M3S'), 3723);
check('PT45S', parseIsoDuration('PT45S'), 45);
check('PT0S (live)', parseIsoDuration('PT0S'), 0);
check('PT2H', parseIsoDuration('PT2H'), 7200);
check('undefined', parseIsoDuration(undefined), 0);
check('garbage', parseIsoDuration('nonsense'), 0);

console.log('\nrules');
const ken = video({ title: 'Minion Giant deck guide' });
check('titleContains hit', titleContains('minion').test(ken), true);
check('titleContains miss', titleContains('hog rider').test(ken), false);
check('titleContains any-of', titleContains('hog', 'GIANT').test(ken), true);
check('titleExcludes blocks', titleExcludes('giant').test(ken), false);
check('anyOf', anyOf(titleContains('zzz'), titleContains('minion')).test(ken), true);
check('not', not(titleContains('minion')).test(ken), false);
check('rules AND: one fails', checkRules(ken, route({ rules: [titleContains('minion'), titleContains('zzz')] })).kind, 'reject');
check('rules AND: all pass', checkRules(ken, route({ rules: [titleContains('minion')] })).kind, 'add');
check('no rules accepts', checkRules(ken, route()).kind, 'add');

console.log('\narabic normalisation');
// Real titles captured from the configured channels' RSS feeds.
const MOKHBIR = 'المُخبر الاقتصادي+ | فرنسا تغرق؟ ديون قد تبتلع الاقتصاد الفرنسي';
const DAHEEH = 'الدحيح | انتقام الحوت القاتل';
const KOMBARS = 'الكومبارس | غزو العراق.. فضائح ومهازل وأكاذيب';
const BEIN_UCL = 'ملخص مباراة كومو ولايبتسيغ | دوري أبطال أوروبا - الجولة الأولى من مرحلة الدوري';
const BEIN_LALIGA = 'ملخص مباراة ريال مدريد ورايو فايكانو | الدوري الإسباني - الجولة 5';
// beIN renamed the English league mid-September 2026. Both forms are real, captured
// from the live feed ten days apart, and both must keep matching.
const BEIN_EPL_OLD = 'ملخص مباراة سندرلاند وآرسنال | الدوري الإنجليزي الممتاز - الجولة 4';
const BEIN_EPL_NEW = 'ملخص مباراة فولهام ومانشستر يونايتد | الدوري الإنجليزي - الجولة 5';
const BEIN_LIGUE1 = 'ملخص مباراة مارسيليا وباريس سان جيرمان | الدوري الفرنسي - الجولة 5';
const BEIN_TENNIS = 'بن شيلتون يبلغ نهائي بطولة أمريكا المفتوحة للتنس';
const BEIN_BIDI = '‫الدوري الإسباني يستعد لإثارة كروية لا تتوقف ومتعة بأعلى طراز';

check('strips tashkeel', normalizeForMatch('المُخبر'), normalizeForMatch('المخبر'));
check('strips bidi controls', normalizeForMatch(BEIN_BIDI).startsWith('‫'), false);
check('unifies alef forms', normalizeForMatch('أبطال') === normalizeForMatch('ابطال'), true);
check('collapses whitespace', normalizeForMatch('a   b'), 'a b');
check('unifies dash variants', normalizeForMatch('a – b'), 'a - b');
check('latin still lowercases', normalizeForMatch('  Minion GIANT '), 'minion giant');

const mokhbirRule = titleContains('المُخبر الاقتصادي');
check('mokhbir matches real title', mokhbirRule.test(video({ title: MOKHBIR })), true);
// The point of normalising: the rule is written with a damma, the title may lack it.
check('mokhbir matches undiacritised title',
  mokhbirRule.test(video({ title: 'المخبر الاقتصادي+ | حلقة جديدة' })), true);
check('mokhbir rejects daheeh', mokhbirRule.test(video({ title: DAHEEH })), false);
check('mokhbir rejects kombars', mokhbirRule.test(video({ title: KOMBARS })), false);

const daheehRule = titleContains('الدحيح');
check('daheeh matches real title', daheehRule.test(video({ title: DAHEEH })), true);
check('daheeh rejects mokhbir', daheehRule.test(video({ title: MOKHBIR })), false);

const beinRule = titleContains(
  'دوري أبطال أوروبا -',
  'الدوري الإسباني - الجولة',
  'الدوري الإنجليزي - الجولة',
  'الدوري الإنجليزي الممتاز - الجولة',
  'كأس الاتحاد الإنجليزي -',
);
check('bein matches champions league', beinRule.test(video({ title: BEIN_UCL })), true);
check('bein matches la liga', beinRule.test(video({ title: BEIN_LALIGA })), true);
check('bein matches english league, old naming', beinRule.test(video({ title: BEIN_EPL_OLD })), true);
check('bein matches english league, new naming', beinRule.test(video({ title: BEIN_EPL_NEW })), true);
check('bein rejects french league', beinRule.test(video({ title: BEIN_LIGUE1 })), false);
check('bein rejects tennis', beinRule.test(video({ title: BEIN_TENNIS })), false);
check('bein rejects la liga promo without round', beinRule.test(video({ title: BEIN_BIDI })), false);

console.log('\nlive and premiere handling');
check('live defers', checkLiveStatus(video({ liveStatus: 'live' })).kind, 'defer');
check('upcoming defers', checkLiveStatus(video({ liveStatus: 'upcoming' })).kind, 'defer');
check('finished is normal', checkLiveStatus(video({ liveStatus: 'none', wasLiveBroadcast: true })).kind, 'add');

console.log('\nshorts and duration');
CONFIG.filters.verifyShortsViaUrl = false; // the URL probe needs network
check('45s rejected as short', (await checkShortsAndDuration(video({ durationSeconds: 45 }), route())).kind, 'reject');
check('170s rejected as short', (await checkShortsAndDuration(video({ durationSeconds: 170 }), route())).kind, 'reject');
check('12m accepted', (await checkShortsAndDuration(video({ durationSeconds: 720 }), route())).kind, 'add');
check('shorts filter off', (await checkShortsAndDuration(video({ durationSeconds: 45 }), route({ excludeShorts: false }))).kind, 'add');
check('over max duration', (await checkShortsAndDuration(video({ durationSeconds: 10800 }), route({ maxDurationMinutes: 90 }))).kind, 'reject');
check('under max duration', (await checkShortsAndDuration(video({ durationSeconds: 3600 }), route({ maxDurationMinutes: 90 }))).kind, 'add');
check('under min duration', (await checkShortsAndDuration(video({ durationSeconds: 400 }), route({ minDurationMinutes: 10 }))).kind, 'reject');
check('format 750s', formatDuration(750), '12m30s');
check('format 3723s', formatDuration(3723), '1h02m');
check('format 45s', formatDuration(45), '45s');

console.log('\nstate');
const rs: RouteState = { decided: [] };
markDecided(rs, 'a'); markDecided(rs, 'b'); markDecided(rs, 'a');
check('no duplicates', rs.decided, ['a', 'b']);
const capped: RouteState = { decided: [] };
CONFIG.maxDecidedIdsPerRoute = 5;
for (let i = 0; i < 12; i++) markDecided(capped, `v${i}`);
check('cap enforced', capped.decided.length, 5);
check('keeps newest', capped.decided, ['v7', 'v8', 'v9', 'v10', 'v11']);
CONFIG.maxDecidedIdsPerRoute = 200;

console.log('\nlogging');
const tmp = mkdtempSync(join(tmpdir(), 'sluice-'));
CONFIG.logs.dir = tmp;
CONFIG.logs.alsoConsole = false;
new Logger('routeA').info('hello');
const written = join(tmp, 'routeA', `${dateStamp()}.log`);
check('log file named by date', readdirSync(join(tmp, 'routeA')), [`${dateStamp()}.log`]);
check('log line contains message', readFileSync(written, 'utf8').includes('INFO  hello'), true);
check('timezone stamp shape', /^\d{4}-\d{2}-\d{2}$/.test(dateStamp()), true);
CONFIG.logs.timezone = 'Asia/Beirut';
check('fullStamp is local, not UTC', fullStamp('2026-08-30T15:39:32.134Z'), '2026-08-30 18:39:32 +03:00');
check('fullStamp accepts a Date', fullStamp(new Date('2026-01-15T09:00:00Z')), '2026-01-15 11:00:00 +02:00');
check('fullStamp handles never', fullStamp(undefined), 'never');

const stale = join(tmp, 'routeA', '2020-01-01.log');
writeFileSync(stale, 'old\n');
const longAgo = Date.now() / 1000 - 40 * 86400;
utimesSync(stale, longAgo, longAgo);
check('prunes stale logs', pruneOldLogs(), 1);
check('keeps current log', readdirSync(join(tmp, 'routeA')), [`${dateStamp()}.log`]);

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  process.exit(1);
}
