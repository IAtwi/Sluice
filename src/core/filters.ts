import { CONFIG } from '../config.js';
import { isShort } from './shorts.js';
import type { Decision, Route, Video } from './types.js';

/**
 * In-progress premieres and live streams are deferred, not rejected. They stay out of
 * state.decided, stay in the RSS feed, and are re-evaluated on the next run. Once finished
 * they read as ordinary videos and flow through the same pipeline. No separate code path.
 */
export function checkLiveStatus(video: Video): Decision {
  if (!CONFIG.filters.deferLiveAndUpcoming) return { kind: 'add' };
  if (video.liveStatus === 'none') return { kind: 'add' };
  const when = video.scheduledStartTime ? `, scheduled ${video.scheduledStartTime}` : '';
  return { kind: 'defer', reason: `${video.liveStatus}${when}` };
}

/** Route rules are AND-combined. Free to evaluate, so these run before any network probe. */
export function checkRules(video: Video, route: Route): Decision {
  for (const rule of route.rules ?? []) {
    if (!rule.test(video)) return { kind: 'reject', reason: `rule: ${rule.name}` };
  }
  return { kind: 'add' };
}

export async function checkShortsAndDuration(video: Video, route: Route): Promise<Decision> {
  const excludeShorts = route.excludeShorts ?? CONFIG.filters.excludeShorts;
  const suspect = CONFIG.filters.shortsSuspectDurationSeconds;

  if (excludeShorts && video.durationSeconds > 0 && video.durationSeconds <= suspect) {
    if (!CONFIG.filters.verifyShortsViaUrl) {
      return { kind: 'reject', reason: `shorts filter (${formatDuration(video.durationSeconds)}, by duration)` };
    }
    let confirmed: boolean;
    try {
      confirmed = await isShort(video.id);
    } catch {
      // Probe unavailable, fall back to the duration heuristic rather than letting a Short through.
      confirmed = true;
    }
    if (confirmed) {
      return { kind: 'reject', reason: `shorts filter (${formatDuration(video.durationSeconds)}, confirmed)` };
    }
  }

  // Duration is also the practical lever for excluding finished live streams, since the API
  // reports a finished premiere and a finished stream identically.
  const min = route.minDurationMinutes ?? CONFIG.filters.minDurationMinutes;
  const max = route.maxDurationMinutes ?? CONFIG.filters.maxDurationMinutes;
  if (min > 0 && video.durationSeconds < min * 60) {
    return { kind: 'reject', reason: `shorter than min ${min}m (${formatDuration(video.durationSeconds)})` };
  }
  if (max > 0 && video.durationSeconds > max * 60) {
    return { kind: 'reject', reason: `longer than max ${max}m (${formatDuration(video.durationSeconds)})` };
  }
  return { kind: 'add' };
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}
