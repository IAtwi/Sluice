# Sluice

Watches YouTube creators and files their new uploads into playlists on your own account,
automatically, on a schedule.

A sluice is a gate that directs flowing water into channels. This does the same with uploads:
each creator's feed flows in, rules decide what passes, and what passes lands in a chosen playlist.

- **No API quota spent on detection.** Discovery uses each channel's public RSS feed, which is
  free and unauthenticated. Quota is only spent when a video is actually added.
- **No runtime dependencies.** Native `fetch` and a small hand parser. TypeScript is the only
  dev dependency. A run is one short-lived process, so nothing sits in RAM between runs.
- **Duplicate-proof.** Every insert is preceded by a playlist membership check, so a video is
  never added twice, even if state is lost or you added it by hand.

---

## How it works

Every run, for each route:

1. Fetch the channel's RSS feed (`youtube.com/feeds/videos.xml?channel_id=UC...`).
   Free, no auth, no quota. Always returns the ~15 most recent uploads.
2. Candidates are feed entries **not yet in `state.decided`**. That set is the whole novelty
   test. There is no "last run time" cutoff, because timestamps are unreliable (see below).
3. One batched `videos.list` call hydrates the candidates with duration and live status
   (1 quota unit for up to 50 videos).
4. Each candidate is decided:
   - **defer** if it is a live stream or premiere still in progress
   - **reject** if it fails the Shorts filter, a duration bound, or one of the route's rules
   - **add** otherwise
5. Additions are checked against the playlist first, then inserted (50 quota units).
6. State is saved, the run is logged, and logs older than the retention window are deleted.

### Why not "videos published since the last run"

That was the original design and it silently loses videos. A video's `publishedAt` is not when
it becomes visible: premieres and scheduled uploads carry an earlier timestamp, so a video can
appear in the feed already stamped before your last run and be skipped forever. A crash after
saving the cursor loses everything in flight too.

Tracking decided video ids instead makes the whole run idempotent. `lastRunAt` is still recorded
per route for logging and future failure notifications, but nothing filters on it.

### Premieres and live streams

A premiere or stream that has not finished is **deferred**: it is not written to `decided`, so it
stays in the feed and is re-evaluated on the next run. Once it ends it looks like an ordinary
video and flows through the normal pipeline. There is no separate code path for it.

Once finished, the API reports a premiere and a live stream **identically**, so they cannot be
told apart. Use `maxDurationMinutes` on a route to exclude long stream VODs.

---

## Setup

### 1. Google Cloud

Adding to a playlist writes to your account, so this needs OAuth, not an API key.

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs & Services -> Library -> enable "YouTube Data API v3".**
3. **APIs & Services -> OAuth consent screen**, type **External**. Fill in the app name and
   your email for both contact fields.
4. Add the scope `https://www.googleapis.com/auth/youtube`.
5. **Audience -> Publish app.** Do not skip this. While the consent screen is in *Testing*,
   refresh tokens expire after **7 days** and the job dies quietly. Unverified is fine, you are
   the only user.
6. **Credentials -> Create credentials -> OAuth client ID -> Desktop app.** Copy the client ID
   and client secret.

### 2. Local

```bash
npm install
cp .env.example .env      # paste in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
npm run build
npm run auth              # opens a consent URL, prints a refresh token
```

At the consent screen you will see *"Google hasn't verified this app"*. Click **Advanced**, then
**Go to Sluice (unsafe)**. That is expected for a personal, unverified app.

Paste the printed refresh token into `.env` as `GOOGLE_REFRESH_TOKEN`.

### 3. Configure routes

Each route is one channel, one destination playlist, one rule set. See `src/routes/ken.ts`.

```ts
export const ken: Route = {
  id: 'ken',                              // unique; used for state and the log folder
  label: 'Ken (@kenforrest)',
  channelId: 'UCiFOL6V9KbvxfXvzdFSsqCw',  // npm run resolve @kenforrest
  playlistId: 'PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // from the playlist URL's list= parameter
  rules: [],                              // empty = accept everything the global filters pass
};
```

Register it in `src/routes/index.ts`. The same channel may appear in several routes with
different rules and playlists, which is how you send one creator's games to different playlists.

```ts
rules: [titleContains('Elden Ring', 'Nightreign'), titleExcludes('reaction')]
```

Available rule builders (`src/core/rules.ts`), AND-combined:

| Builder | Passes when |
|---|---|
| `titleContains(...terms)` | title contains **any** term, case insensitive |
| `titleExcludes(...terms)` | title contains **none** of the terms |
| `titleMatches(regex)` | title matches the pattern |
| `descriptionContains(...terms)` | description contains any term |
| `durationBetween(min, max)` | duration falls between, in minutes |
| `anyOf(...rules)` | any nested rule passes (OR) |
| `not(rule)` | the nested rule fails |

Per-route overrides: `excludeShorts`, `minDurationMinutes`, `maxDurationMinutes`, `enabled`.

### 4. First run

```bash
npm run init    # marks everything currently in each feed as seen, adds nothing
npm run dry     # evaluates and logs, but never writes to a playlist
npm start       # live
```

**Always run `npm run init` first.** Without it, the first live run adds the last ~15 videos
from every creator to your playlists.

---

## Deploy to the VPS (Ubuntu)

Node 18 from Ubuntu's own repo is end of life. Install Node 22, and use NodeSource rather than
nvm: nvm installs outside `/usr/bin`, and cron's minimal PATH will not find it.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo timedatectl set-timezone Asia/Beirut     # keeps log names aligned with your clock

git clone <repo> ~/sluice && cd ~/sluice
npm ci && npm run build
nano .env                                      # the three secrets
npm run init
npm run dry                                    # confirm before going live
```

```cron
*/30 * * * * cd $HOME/sluice && /usr/bin/flock -n /tmp/sluice.lock /usr/bin/node dist/main.js 2>&1 | /usr/bin/logger -t sluice
```

`flock` stops a slow run from overlapping the next one. Piping to `logger` sends crash output to
journald, which rotates itself; without it cron tries to email the output and fills `/var/mail`.
Read crashes with `journalctl -t sluice -n 50`.

---

## Logs

One file per route per day, named by date, under `logs/<route-id>/YYYY-MM-DD.log`, plus a
cross-route `logs/_summary/`. Files older than `logs.retentionDays` (default 7) are deleted at
the end of every run, so the directory cannot grow without bound.

```
=== run 2026-08-30T15:39:32.134Z | Ken (@kenforrest) | last run 2026-08-30T15:09:02.881Z ===
18:39:32 INFO  feed ok: 15 item(s) in feed, 2 candidate(s)
18:39:33 INFO  DEFER  ghi789 "Tourney Push" (live)
18:39:33 INFO  ADDED  I4CsWt-lp08 "Minion Giant"
                -> playlist PLxxxx | 12m30s | published 2026-08-30T15:00:02Z | added 2026-08-30T15:39:33Z
18:39:33 INFO  done: 1 added, 0 skipped, 1 deferred, 0 error(s) in 1.4s
```

Timestamps and file names use `logs.timezone` (default `Asia/Beirut`), not the server clock, so
they read correctly even on a UTC VPS. Set `logs.level` to `debug` to log every rejection reason.

---

## Configuration

All tunables are in **`src/config.ts`**. Only the three OAuth secrets live in `.env`.
Rebuild (`npm run build`) after changing config.

## Commands

| Command | Does |
|---|---|
| `npm start` | one normal run |
| `npm run dry` | evaluate and log, never write to a playlist |
| `npm run init` | mark current feed contents as seen, add nothing |
| `npm run auth` | one-time OAuth flow, prints a refresh token |
| `npm run resolve @handle` | look up a channel id (1 quota unit) |
| `npm run selftest` | offline checks of parsing, rules, filters, state, logging |
| `npm run build` | compile to `dist/` |

Flags: `--dry-run`, `--init`, `--route=<id>`, `--help`.

## Quota

The daily limit is 10,000 units.

| Operation | Cost |
|---|---|
| RSS feed read | 0 |
| Shorts URL check | 0 |
| `videos.list` (batched, up to 50) | 1 |
| playlist membership check | 1 |
| **playlist insert** | **50** |

Roughly 50 units per day of fixed cost at a 30 minute cadence, leaving room for about 190 video
additions per day. Because detection is free, polling more often costs nothing extra.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_grant` on every run | Consent screen still in *Testing*, so the refresh token expired after 7 days. Publish the app, then `npm run auth` again. |
| `node: command not found` in cron | Node installed via nvm. Use NodeSource, or put the absolute path in the crontab. |
| Videos added twice | Should be impossible. Check that `playlistId` is right and that two routes do not target the same playlist with overlapping rules. |
| Nothing ever added | Run `npm run dry` and read the log. Most often a rule rejects everything, or `init` has just marked the backlog as seen (which is correct). |
| Log files dated a day off | Server timezone differs from `logs.timezone`. Set both. |
