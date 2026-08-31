import { CONFIG } from '../config.js';
import { fetchFeed } from './feed.js';
import { checkLiveStatus, checkRules, checkShortsAndDuration, formatDuration } from './filters.js';
import { fullStamp, Logger } from './logger.js';
import { markDecided, routeState } from './state.js';
import type { Decision, Route, RunStats, State, Video } from './types.js';
import { addToPlaylist, getPlaylistTitle, getVideos, isInPlaylist } from './youtube.js';

export interface RunOptions {
  dryRun: boolean;
  /** Seed every route from its current feed. */
  init: boolean;
  /**
   * Seed only routes that have never been initialised, leaving existing ones untouched.
   * Used by deploy.sh: a blanket --init on every deploy would mark a genuinely new upload
   * as seen if it appeared between the last cron run and the deploy.
   */
  initNew: boolean;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** '"Sluice_CR" (PLdoqNGbOIGUI)', falling back to the bare id if the title cannot be fetched. */
async function playlistLabel(playlistId: string): Promise<string> {
  const title = await getPlaylistTitle(playlistId);
  return title ? `"${title}" (${playlistId})` : playlistId;
}

/**
 * Decision order matters: the live check gates everything, then the free rule checks,
 * and only then the shorts probe, which costs an HTTP request.
 */
async function decide(video: Video, route: Route): Promise<Decision> {
  const live = checkLiveStatus(video);
  if (live.kind !== 'add') return live;

  const rules = checkRules(video, route);
  if (rules.kind !== 'add') return rules;

  return checkShortsAndDuration(video, route);
}

export async function runRoute(route: Route, state: State, opts: RunOptions): Promise<RunStats> {
  const log = new Logger(route.id);
  const stats: RunStats = { added: 0, rejected: 0, deferred: 0, errors: 0 };
  const rs = routeState(state, route.id);
  const startedAt = new Date();
  const label = route.label ?? route.id;
  const uninitialised = rs.lastRunAt === undefined && rs.decided.length === 0;

  // Return before the try block so lastRunAt is not stamped for a route we never looked at.
  if (opts.initNew && !uninitialised) {
    log.raw('');
    log.raw(`=== init-new ${fullStamp(startedAt)} | ${label} ===`);
    log.info('already initialised, left untouched');
    return stats;
  }

  log.raw('');
  log.raw(`=== run ${fullStamp(startedAt)} | ${label} | last run ${fullStamp(rs.lastRunAt)} ===`);

  try {
    const entries = await fetchFeed(route.channelId);

    if (opts.init || opts.initNew) {
      let seeded = 0;
      for (const entry of entries) {
        if (!rs.decided.includes(entry.videoId)) {
          markDecided(rs, entry.videoId);
          seeded++;
        }
      }
      log.info(`init: marked ${seeded} existing upload(s) as seen. Nothing was added.`);
      return stats;
    }

    // Safety net: a route that has never been initialised would treat its entire current
    // feed as new and add ~15 back-catalogue videos in one go. Refuse instead. This covers
    // forgetting --init on a fresh deploy, and adding a new creator to an existing install.
    if (uninitialised) {
      log.warn(
        `route has never been initialised, skipping to avoid adding the existing backlog. ` +
          `Run:  node dist/main.js --init --route=${route.id}`,
      );
      return stats;
    }

    // The feed only ever holds ~15 uploads, so "in the feed and not yet decided" is the
    // whole novelty test. lookbackDays is only a guard against a long outage backfilling.
    const cutoff = Date.now() - CONFIG.lookbackDays * 86_400_000;
    const candidates = entries.filter(
      (e) => !rs.decided.includes(e.videoId) && Date.parse(e.publishedAt) >= cutoff,
    );

    log.info(`feed ok: ${entries.length} item(s) in feed, ${candidates.length} candidate(s)`);
    if (candidates.length === 0) return stats;

    const videos = await getVideos(candidates.map((c) => c.videoId));

    for (const candidate of candidates) {
      const video = videos.get(candidate.videoId);

      if (!video) {
        log.warn(`SKIP   ${candidate.videoId} "${candidate.title}" not returned by the API (deleted, private or blocked)`);
        markDecided(rs, candidate.videoId);
        stats.rejected++;
        continue;
      }

      try {
        const decision = await decide(video, route);

        if (decision.kind === 'defer') {
          // Deliberately left undecided so it is picked up again once finished.
          log.info(`DEFER  ${video.id} "${video.title}" (${decision.reason})`);
          stats.deferred++;
          continue;
        }

        if (decision.kind === 'reject') {
          log.debug(`SKIP   ${video.id} "${video.title}" (${decision.reason})`);
          markDecided(rs, video.id);
          stats.rejected++;
          continue;
        }

        if (await isInPlaylist(route.playlistId, video.id)) {
          log.info(
            `EXISTS ${video.id} "${video.title}" already in ${await playlistLabel(route.playlistId)}, marking seen`,
          );
          markDecided(rs, video.id);
          stats.rejected++;
          continue;
        }

        if (opts.dryRun) {
          // Not marked decided, so a real run afterwards still adds it.
          log.info(
            `WOULD ADD ${video.id} "${video.title}" -> ${await playlistLabel(route.playlistId)} | ` +
              `${formatDuration(video.durationSeconds)} | published ${fullStamp(video.publishedAt)}`,
          );
          stats.added++;
          continue;
        }

        await addToPlaylist(route.playlistId, video.id);
        markDecided(rs, video.id);
        stats.added++;
        log.info(`ADDED  ${video.id} "${video.title}"`);
        log.raw(
          `                -> playlist ${await playlistLabel(route.playlistId)} | ` +
            `${formatDuration(video.durationSeconds)} | ` +
            `published ${fullStamp(video.publishedAt)} | added ${fullStamp(new Date())}`,
        );
      } catch (err) {
        // Left undecided on purpose: the next run retries it, and isInPlaylist prevents a duplicate.
        stats.errors++;
        log.error(`ERROR  ${video.id} "${video.title}": ${message(err)}`);
      }
    }
  } catch (err) {
    stats.errors++;
    log.error(`route failed: ${message(err)}`);
  } finally {
    rs.lastRunAt = startedAt.toISOString();
    if (stats.errors === 0) rs.lastSuccessAt = new Date().toISOString();
    const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
    log.info(
      `done: ${stats.added} added, ${stats.rejected} skipped, ${stats.deferred} deferred, ` +
        `${stats.errors} error(s) in ${elapsed}s`,
    );
  }

  return stats;
}
