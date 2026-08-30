#!/usr/bin/env bash
#
# Update Sluice on the server. One command, safe to re-run.
#
#   ./deploy.sh
#
# Cron never needs changing: it runs dist/main.js, which this rebuilds in place.
# .env and state.json are gitignored, so neither is touched.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> pulling"
git pull --ff-only

echo "==> installing build tools"
npm ci

echo "==> building"
npm run build

# Seeds any route added since the last deploy, so it starts from now instead of
# adding its whole back catalogue. Existing routes are deliberately left alone:
# a blanket --init here would mark an upload that landed since the last cron run
# as already seen, and you would lose it.
echo "==> initialising any new routes"
node dist/main.js --init-new

# Sluice has no runtime dependencies, so the 26MB of TypeScript is only needed to
# compile. Dropping it keeps the footprint at roughly 76KB between deploys.
echo "==> pruning node_modules"
rm -rf node_modules

echo
echo "Done. Cron picks up the new build on its next run."
