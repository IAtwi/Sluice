#!/usr/bin/env bash
#
# Update Sluice on the server. Safe to re-run.
#   ./deploy.sh
#
# Cron needs no changes: it runs dist/main.js, which this rebuilds in place.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> pulling"
git pull --ff-only

echo "==> installing build tools"
npm ci

echo "==> building"
npm run build

# Sluice has no runtime dependencies, so the 26MB of TypeScript is only needed
# to compile. Dropping it keeps the footprint at ~76KB between deploys.
echo "==> pruning node_modules"
rm -rf node_modules

echo
echo "Done. Cron picks up the new build on its next run."
echo "If you added a route, initialise it before it will do anything:"
echo "    node dist/main.js --init --route=<id>"
