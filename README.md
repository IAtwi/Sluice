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

Google Cloud now requires two-step verification on your account before the console will open.
Turn it on at [myaccount.google.com/security](https://myaccount.google.com/security) if prompted.
This does not affect the automation: 2SV applies to interactive sign-in, never to the refresh
token the VPS uses.

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs & Services -> Library -> enable "YouTube Data API v3".**
   Do this **first**. The scope in step 4 will not appear in the picker otherwise.
3. **APIs & Services -> OAuth consent screen -> Get started.** Fill the form:
   app name `Sluice`, your email as support contact, audience **External**
   (Internal requires Google Workspace), your email again as developer contact.
4. **Data Access -> Add or remove scopes** -> select `https://www.googleapis.com/auth/youtube`
   -> Update -> Save. It is flagged as a sensitive scope, which is expected.
5. **Audience -> Publish app.** Do not skip this. While it says *Testing*, refresh tokens expire
   after **7 days** and the job dies quietly a week later. Unverified is fine, you are the only
   user, and no verification process is needed.
6. **Clients -> Create client -> application type "Desktop app".** Copy the client ID and
   client secret into `.env`.

The console labels these under "Google Auth Platform". If your UI differs, the sequence is the
same: create the app, grant the youtube scope, publish it, then create a Desktop app client.

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
npm run check   # confirms every channel and playlist resolves
npm run init    # marks everything currently in each feed as seen, adds nothing
npm run dry     # evaluates and logs, but never writes to a playlist
npm start       # live
```

**Always run `npm run init` first.** It marks everything currently in each feed as already seen,
so nothing existing is added. Only uploads that appear *after* that point are ever routed.

As a safety net, a route with no state at all refuses to run and warns instead, so forgetting
`init` cannot dump a backlog into a playlist. Initialise a single route with:

```bash
node dist/main.js --init --route=ken
```

`state.json` is per-machine and not in git, so **run `npm run init` again on the VPS** after
deploying. Initialising locally does not initialise the server.

---

## Deploy to the VPS (Ubuntu)

Node 18 from Ubuntu's own repo is end of life. Install Node 22, and use NodeSource rather than
nvm: nvm installs outside `/usr/bin`, and cron's minimal PATH will not find it.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo timedatectl set-timezone Asia/Beirut     # keeps log names aligned with your clock

git clone https://github.com/IAtwi/Sluice.git ~/sluice && cd ~/sluice
npm ci && npm run build
nano .env                                      # the three secrets
npm run check                                  # channel + playlist resolve
npm run init                                   # mark the current backlog as seen
npm run dry                                    # confirm before going live
npm start                                      # first real run
```

Sluice has no runtime dependencies, so once `dist/` is built, `node_modules` (26 MB of
TypeScript, needed only to compile) can be deleted. The running program is 76 KB:

```bash
rm -rf node_modules       # restore with npm ci when you next need to rebuild
```

```cron
*/30 * * * * cd $HOME/sluice && /usr/bin/flock -n /tmp/sluice.lock /usr/bin/node dist/main.js 2>&1 | /usr/bin/logger -t sluice
```

Use the literal path rather than `$HOME` if you prefer, and note the `cd` is required: Sluice
resolves `.env`, `state.json` and `logs/` relative to the working directory, and cron does not
start in the project folder.

`flock` stops a slow run from overlapping the next one. Piping to `logger` sends output to
journald, which rotates itself; without it cron tries to email the output and fills `/var/mail`.

### Watching it run

Sluice writes every line to its own log files *and* to stdout, so with the crontab above the full
log also reaches journald. That gives you two views:

```bash
journalctl -t sluice -f                        # live, follows across midnight
tail -f ~/sluice/logs/ken/$(date +%F).log      # one route, one day
```

Prefer `journalctl -f` for watching. The `tail` command resolves `$(date +%F)` once, so at
midnight Sluice starts a new dated file and your `tail` silently follows the old one forever.

**Never open a log file in a text editor.** Sluice appends to the current day's file every 30
minutes, and an editor writes its whole buffer back on save, silently discarding anything
appended since you opened it. Use `tail`, `less` or `journalctl`, which only read.

If a log looks empty or truncated, nothing is lost: journald holds the same lines. Recover with
`journalctl -t sluice --since today`. The authoritative answer to "is it actually running" is
`lastRunAt` in `state.json`, which every run updates.

A run that finds nothing still logs, which is how you tell "working" from "not running":

```
=== run 2026-08-30 18:30:01 +03:00 | Ken (@kenforrest) | last run 2026-08-30 18:00:02 +03:00 ===
18:30:01 INFO  feed ok: 15 item(s) in feed, 0 candidate(s)
18:30:02 INFO  done: 0 added, 0 skipped, 0 deferred, 0 error(s) in 0.9s
```

Most runs look like this. Ken uploads roughly daily, so expect one interesting run in about 48.
Check the schedule itself with `crontab -l`, and confirm the daemon is up with
`systemctl is-active cron`.

### Updating the server

One command:

```bash
cd ~/sluice && ./deploy.sh
```

It pulls, installs the build tools, rebuilds, initialises any route you added since the last
deploy, and prunes `node_modules` again. Nothing else is needed:

- **Cron is untouched.** It runs `dist/main.js`, which is replaced in place.
- **`.env` and `state.json` survive**, both gitignored, so a pull cannot overwrite them.
- **New routes are seeded automatically**, so a creator you add starts from now rather than
  adding their entire back catalogue.

Existing routes are deliberately *not* re-initialised on deploy. A blanket `--init` would mark an
upload that landed since the last cron run as already seen, and you would lose it. `--init-new`
only touches routes that have never been initialised.

By hand it is:

```bash
git pull && npm ci && npm run build && node dist/main.js --init-new && rm -rf node_modules
```

`npm ci` is not optional once `node_modules` has been pruned, since `npm run build` needs the
TypeScript compiler. Skipping it gives `tsc: not found`.

---

## Logs

One file per route per day, named by date, under `logs/<route-id>/YYYY-MM-DD.log`, plus a
cross-route `logs/_summary/`. Files older than `logs.retentionDays` (default 7) are deleted at
the end of every run, so the directory cannot grow without bound.

```
=== run 2026-08-30 18:39:32 +03:00 | Ken (@kenforrest) | last run 2026-08-30 18:09:02 +03:00 ===
18:39:32 INFO  feed ok: 15 item(s) in feed, 2 candidate(s)
18:39:33 INFO  DEFER  ghi789 "Tourney Push" (live)
18:39:33 INFO  ADDED  I4CsWt-lp08 "Minion Giant"
                -> playlist PLxxxx | 12m30s | published 2026-08-30 18:00:02 +03:00 | added 2026-08-30 18:39:33 +03:00
18:39:33 INFO  done: 1 added, 0 skipped, 1 deferred, 0 error(s) in 1.4s
```

Every time in the logs is rendered in `logs.timezone` (default `Asia/Beirut`) with its UTC offset,
not the server clock, so they read correctly even on a UTC VPS. The offset tracks DST on its own.

`state.json` is the opposite on purpose: it stores raw UTC ISO timestamps, because it is data
rather than something you read, and it has to stay unambiguous if the timezone setting ever
changes. Logs are for you, state is for the machine.

Set `logs.level` to `debug` to log every rejection reason.

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
| `npm run init -- --route=<id>` | same, but for one route only. Use when adding a creator |
| `npm run init:new` | seed only routes never initialised before, leaving the rest alone |
| `./deploy.sh` | **the server update command**: pull, rebuild, seed new routes, prune |
| `npm run auth` | one-time OAuth flow, prints a refresh token |
| `npm run check` | verify every route's channel feed and playlist resolve (1 unit per route) |
| `npm run resolve @handle` | look up a channel id (1 quota unit) |
| `npm run selftest` | offline checks of parsing, rules, filters, state, logging |
| `npm run build` | compile to `dist/` |

Flags: `--dry-run`, `--init`, `--init-new`, `--check`, `--route=<id>`, `--help`.

## Quota

The daily limit is 10,000 units.

| Operation | Cost |
|---|---|
| RSS feed read | 0 |
| Shorts URL check | 0 |
| `videos.list` (batched, up to 50) | 1 |
| playlist membership check | 1 |
| `playlists.list` (preflight `--check`) | 1 |
| **playlist insert** | **50** |

Roughly 50 units per day of fixed cost at a 30 minute cadence, leaving room for about 190 video
additions per day. Because detection is free, polling more often costs nothing extra.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_grant` on every run | Consent screen still in *Testing*, so the refresh token expired after 7 days. Publish the app, then `npm run auth` again. |
| "limited to 100 sensitive scope logins until verified" | Not a problem. That is a cap of 100 distinct *users* granting consent, and you are one. It applies only to `npm run auth`, never to the token refreshes the cron job performs. Verification is not needed for personal use. |
| "Google hasn't verified this app" during `npm run auth` | Expected and permanent for an unverified personal app. Click Advanced, then "Go to Sluice". |
| `node: command not found` in cron | Node installed via nvm. Use NodeSource, or put the absolute path in the crontab. |
| Videos added twice | Should be impossible. Check that `playlistId` is right and that two routes do not target the same playlist with overlapping rules. |
| Nothing ever added | Run `npm run dry` and read the log. Most often a rule rejects everything, or `init` has just marked the backlog as seen (which is correct). |
| Log files dated a day off | Server timezone differs from `logs.timezone`. Set both. |
