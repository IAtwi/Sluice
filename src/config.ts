/**
 * Sluice global configuration.
 *
 * Everything tunable lives here. Only OAuth secrets live in .env.
 * Per-route overrides are set in src/routes/*.ts and win over these defaults.
 */
export const CONFIG = {
  /**
   * Safety guard only. The real "is this new?" test is whether a video id is
   * already in state.decided. This just stops a long outage from dumping a
   * whole backlog into a playlist when the script comes back up.
   */
  lookbackDays: 30,

  /** How many decided video ids to remember per route. The RSS feed only ever
   *  returns ~15 items, so this is deliberately generous. */
  maxDecidedIdsPerRoute: 200,

  filters: {
    /** Skip YouTube Shorts. */
    excludeShorts: true,
    /** Videos at or under this length are candidates for the Shorts check. */
    shortsSuspectDurationSeconds: 180,
    /** Confirm a suspected Short via youtube.com/shorts/<id> (free, no quota).
     *  If false, anything under shortsSuspectDurationSeconds is treated as a Short. */
    verifyShortsViaUrl: true,
    /** Live streams and premieres that have not finished are left undecided and
     *  re-checked on the next run, so they flow through the normal pipeline once done. */
    deferLiveAndUpcoming: true,
    /** Duration bounds in minutes. 0 disables the bound. */
    minDurationMinutes: 0,
    maxDurationMinutes: 0,
  },

  logs: {
    dir: 'logs',
    /** Delete log files older than this many days, at the end of every run. */
    retentionDays: 7,
    /** 'daily' = one file per route per day. 'per-run' = one file per run. */
    granularity: 'daily' as 'daily' | 'per-run',
    /** 'debug' also logs every rejection reason. */
    level: 'info' as 'debug' | 'info' | 'warn' | 'error',
    /** Also print to stdout. Cron pipes this to journald. */
    alsoConsole: true,
    /** Log file names and timestamps use this timezone, whatever the server clock says. */
    timezone: 'Asia/Beirut',
  },

  http: {
    timeoutMs: 15000,
    retries: 2,
    retryDelayMs: 2000,
    userAgent: 'Sluice/1.0 (+https://github.com/)',
  },

  /** Evaluate and log everything, but never write to a playlist. Also --dry-run. */
  dryRun: false,

  /** Paths, relative to the project root. */
  paths: {
    state: 'state.json',
  },
};

export type Config = typeof CONFIG;
