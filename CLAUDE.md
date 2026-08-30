# CLAUDE.md

Context for Claude Code working on Sluice. Read this before changing behaviour.

## What this is

A personal automation that files new uploads from chosen YouTube creators into playlists on
Hadi's own account. Runs on a small Ubuntu 24 VPS (eVPS.net) via cron every 30 minutes, next to
an existing Python Discord bot. Resources are tight, so lightness is a hard requirement, not a
preference.

Developed locally at `D:\Programming\VPS\Sluice`, pushed to GitHub, pulled on the VPS.

## Architecture

```
src/
  config.ts          all global tunables; the only place to change behaviour
  main.ts            arg parsing, route loop, state persistence, log pruning
  core/
    types.ts         Route, Rule, Video, Decision, RouteState
    env.ts           minimal .env reader (no dotenv dependency)
    http.ts          fetch with timeout and bounded retries
    feed.ts          RSS fetch and hand parser
    youtube.ts       OAuth token, videos.list, playlistItems list/insert, handle resolve
    shorts.ts        /shorts/<id> probe
    filters.ts       live check, rule check, shorts and duration checks
    rules.ts         reusable rule builders
    state.ts         atomic load/save of state.json
    logger.ts        per-route timezone-aware file logger and retention pruning
    runner.ts        the per-route pipeline
  routes/            one file per creator, registered in index.ts
  scripts/           get-refresh-token, resolve, selftest
```

## Design decisions, and why

These were reasoned through deliberately. Do not undo them without a reason.

**1. Novelty is tracked by decided video ids, not a last-run timestamp.**
The original plan filtered on "published after last run". That silently loses videos: a
premiere or scheduled upload carries a `publishedAt` earlier than when it appears, so it can
surface already stamped before the last run and be skipped permanently. A crash after saving the
cursor loses in-flight videos too. `state.decided` makes the run idempotent.
`lastRunAt` and `lastSuccessAt` are recorded for logging and future notifications only. Nothing
filters on them. **Do not reintroduce timestamp-based filtering.**

**2. There is no lookback window in the novelty test.**
The RSS feed only ever returns ~15 items, so the candidate set is already bounded.
`CONFIG.lookbackDays` (default 30) is purely a guard so a month-long outage does not backfill a
whole playlist on restart. An earlier draft had a 7-day window plus a `pending` array for
deferred videos; both were removed because "in the feed and not yet decided" subsumes them.

**3. Deferral is the absence of a decision, not a separate flow.**
Live and upcoming videos are simply not written to `decided`. They stay in the feed and get
re-evaluated next run, through the same pipeline. This was an explicit requirement: no separate
premiere handling. `Decision.kind === 'defer'` exists only so the runner knows not to record it.

**4. Discovery never uses `search.list`.**
It costs 100 quota units per call. At 48 runs a day across even 3 channels that is 14,400 units
against a 10,000 daily limit. RSS is free and returns the same information.

**5. Every insert is preceded by `isInPlaylist`.**
Costs 1 unit and makes duplicates impossible from any cause: an insert that succeeded but
returned 5xx, a manually added video, or a deleted `state.json`. Cheap insurance given inserts
are rare.

**6. Inserts are never retried (`retries: 0`).**
A blind retry after a 5xx risks a duplicate. On error the video is left **undecided**, so the
next run retries it, and `isInPlaylist` prevents the duplicate. This pairing is the point.

**7. Zero runtime dependencies.**
Native `fetch`, a regex RSS parser, a hand-rolled `.env` reader. Deliberately avoids `googleapis`
(over 100MB installed, slow startup) and `dotenv`. **Do not add runtime dependencies.**

**8. Cron one-shot, not a resident daemon.**
`node-cron` would hold RAM permanently next to the Discord bot. A one-shot process exits in
seconds. `flock` in the crontab prevents overlap with no application-level locking.

**9. Log stamps use `CONFIG.logs.timezone`, not the server clock. State stays UTC.**
A UTC VPS would otherwise roll log files at 03:00 Beirut time, putting one evening's activity in
two files. `Intl.DateTimeFormat` with `hourCycle: 'h23'`.
Everything human facing goes through `fullStamp()` in `logger.ts`, which renders the instant in
the configured zone with its UTC offset (DST aware). `state.json` deliberately keeps raw UTC ISO
strings: it is machine data and must stay unambiguous if the timezone setting changes.
**Do not print a bare `toISOString()` into a log line**, that was a real bug: run headers showed
UTC while line prefixes showed local, three hours apart on adjacent lines.

**10. Rule checks run before the Shorts URL probe.**
Rules are free; the probe is an HTTP request. Order is set in `runner.ts:decide()`.

## Known limitations

- **A finished premiere and a finished live stream are indistinguishable** via the API: both
  report `liveBroadcastContent: 'none'` with `liveStreamingDetails` present. Accepted for now.
  Use `maxDurationMinutes` per route to exclude long stream VODs. Do not invent a
  fake-precise heuristic to tell them apart.
- **The Shorts probe is unofficial.** `youtube.com/shorts/<id>` returning 200 means a Short, a
  redirect means a normal video. If it breaks, `CONFIG.filters.verifyShortsViaUrl = false` falls
  back to a pure duration heuristic. Duration alone is not conclusive since Shorts can run to 3
  minutes.
- **RSS holds only ~15 videos.** A multi-day outage on a high-volume channel could miss uploads.
  The escape hatch, if it ever matters, is the uploads playlist (`UC...` becomes `UU...`),
  paginated at 1 unit per 50 videos. Not implemented; do not add it speculatively.

## Google Cloud facts worth not relearning

- Publishing the consent screen to production is required. In *Testing*, refresh tokens expire
  after 7 days and the cron job dies silently.
- Publishing to production requires a reachable homepage URL and privacy policy URL. Those are
  served from `docs/` via GitHub Pages.
- The "limited to 100 sensitive scope logins" warning is a 100-*user* cap on consent grants, not
  a request or refresh limit. One user, so it is irrelevant. Verification is never needed here.
- The console UI is now "Google Auth Platform": scopes live under Data Access, OAuth clients
  under Clients (formerly Credentials).

## Invariants

- `markDecided` is called for **added** and **rejected** videos only. Never for deferred ones.
- `saveState` runs in a `finally`, so partial progress survives a mid-run failure.
- State writes are atomic (temp file then rename).
- Logging failures are swallowed. Logging must never kill a run.
- The logger only ever appends (`appendFileSync`). It never truncates, so an empty or short log
  means either no runs happened or something external rewrote the file (a text editor will).
  journald holds a duplicate of every line while `logs.alsoConsole` is true.
- Human-facing times go through `fullStamp()`. Machine-facing times stay UTC ISO.
- A corrupt `state.json` throws rather than silently resetting history.
- `npm run init` must be run before the first live run, or the backlog gets added. Enforced:
  a route with `lastRunAt === undefined && decided.length === 0` skips with a warning rather
  than adding its whole feed. This covers a fresh deploy and a newly added creator.
  `state.json` is gitignored, so every machine needs its own init. Per route:
  `node dist/main.js --init --route=<id>`.
- `dist/` is gitignored. A server pull brings source only, so a rebuild is always required.
  `deploy.sh` is the single server command: pull, `npm ci`, build, `--init-new`, prune.
  Cron never needs changing: it runs `dist/main.js`, replaced in place.
- `--init-new` seeds ONLY routes with no state. Never make deploy run a blanket `--init`: it
  would mark an upload that landed between the last cron run and the deploy as seen, losing it.

## Testing

`npm run selftest` covers everything that needs no network or credentials: feed parsing, entity
decoding, ISO durations, rules, filters, state capping, log naming and retention. 44 assertions.

`npm run check` is the preflight: it confirms each route's channel feed resolves and its playlist
exists and is owned by the authenticated account. Run it after adding any route.

`fixtures/UCiFOL6V9KbvxfXvzdFSsqCw.xml` is a real capture of Ken's feed. Setting
`SLUICE_FIXTURE_DIR=fixtures` makes `feed.ts` read from disk instead of the network, which also
lets `--init` be exercised offline.

Note: the development sandbox cannot reach `youtube.com`. Anything touching the live API has to
be verified on the VPS or on Hadi's own machine.

## Environment notes

- Playlist ids are not always 34 characters. `PLdoqNGbOIGUI` is a real, valid id. Do not "fix"
  short-looking ids; verify with `npm run check` instead.
- Node 22. Ubuntu 24's apt `nodejs` is 18.19 and end of life; use NodeSource so `node` lands in
  `/usr/bin` where cron's minimal PATH can find it. nvm breaks cron.
- The mounted working folder does not permit file deletion. Overwrite instead of `rm`.

## Current routes

| id | creator | playlist | rules |
|---|---|---|---|
| `ken` | Ken (@kenforrest), Clash Royale, `UCiFOL6V9KbvxfXvzdFSsqCw` | `PLdoqNGbOIGUI` ("Sluice_CR", private, verified) | none |

More creators to be added once the first is running.
