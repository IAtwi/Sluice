import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../config.js';
import type { RouteState, State } from './types.js';

export function loadState(): State {
  const path = CONFIG.paths.state;
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as State) : {};
  } catch {
    // Never silently reset history: a corrupt file is a stop condition.
    throw new Error(
      `${path} is not valid JSON. Fix it, or delete it and re-run with --init to reseed without backfilling.`,
    );
  }
}

/** Atomic: write a temp file then rename, so a crash mid-write cannot corrupt state. */
export function saveState(state: State): void {
  const path = CONFIG.paths.state;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function routeState(state: State, routeId: string): RouteState {
  const existing = state[routeId];
  if (existing) {
    if (!Array.isArray(existing.decided)) existing.decided = [];
    return existing;
  }
  const fresh: RouteState = { decided: [] };
  state[routeId] = fresh;
  return fresh;
}

/**
 * Records a final decision. Only called for added or rejected videos, never for
 * deferred ones, which is what lets an in-progress premiere re-enter the pipeline.
 */
export function markDecided(rs: RouteState, videoId: string): void {
  if (rs.decided.includes(videoId)) return;
  rs.decided.push(videoId);
  const overflow = rs.decided.length - CONFIG.maxDecidedIdsPerRoute;
  if (overflow > 0) rs.decided.splice(0, overflow);
}
