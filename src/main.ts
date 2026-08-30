import { CONFIG } from './config.js';
import { loadEnv } from './core/env.js';
import { Logger, pruneOldLogs } from './core/logger.js';
import { runRoute } from './core/runner.js';
import { loadState, saveState } from './core/state.js';
import { routes } from './routes/index.js';

function printHelp(): void {
  console.log(`
Sluice - routes new YouTube uploads into playlists on your account.

  npm start            run normally
  npm run dry          evaluate and log, but never write to a playlist
  npm run init         mark everything currently in each feed as seen, add nothing
  npm run auth         one-time OAuth flow to mint a refresh token
  npm run resolve @x   look up a channel id from its @handle
  npm run selftest     offline checks of parsing, rules, filters and state

Flags: --dry-run  --init  --route=<id>  --help
`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const dryRun = CONFIG.dryRun || args.includes('--dry-run');
  const init = args.includes('--init');
  const only = args.find((a) => a.startsWith('--route='))?.split('=')[1];

  loadEnv();
  const summary = new Logger('_summary');

  const selected = routes.filter((r) => r.enabled !== false && (!only || r.id === only));
  if (selected.length === 0) {
    summary.warn(only ? `no enabled route matches --route=${only}` : 'no enabled routes configured');
    return 1;
  }

  const mode = init ? 'init' : dryRun ? 'dry-run' : 'live';
  summary.info(`start: ${selected.length} route(s), mode=${mode}`);

  const state = loadState();
  const totals = { added: 0, rejected: 0, deferred: 0, errors: 0 };

  try {
    for (const route of selected) {
      const stats = await runRoute(route, state, { dryRun, init });
      totals.added += stats.added;
      totals.rejected += stats.rejected;
      totals.deferred += stats.deferred;
      totals.errors += stats.errors;
      summary.info(
        `${route.id}: ${stats.added} added, ${stats.rejected} skipped, ` +
          `${stats.deferred} deferred, ${stats.errors} error(s)`,
      );
    }
  } finally {
    // Persist whatever progress was made, even if a route threw partway through.
    saveState(state);
    const pruned = pruneOldLogs();
    summary.info(
      `end: ${totals.added} added, ${totals.rejected} skipped, ${totals.deferred} deferred, ` +
        `${totals.errors} error(s)` + (pruned > 0 ? `, pruned ${pruned} old log file(s)` : ''),
    );
  }

  return totals.errors > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('sluice: fatal', err);
    process.exit(1);
  });
