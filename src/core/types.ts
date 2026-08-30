/** A named predicate applied to a candidate video. Rules are AND-combined. */
export interface Rule {
  /** Shown in logs when this rule rejects a video. */
  name: string;
  test: (video: Video) => boolean;
}

/**
 * A route is the unit of work: one channel, one destination playlist, one rule set.
 * The same channel may appear in several routes with different rules and playlists.
 */
export interface Route {
  /** Unique. Used as the state key and the log folder name. */
  id: string;
  /** Human label for logs. Defaults to id. */
  label?: string;
  /** Channel id, the UC... form. Use `npm run resolve @handle` to find it. */
  channelId: string;
  /** Destination playlist id, the PL... form, from the playlist URL's list= parameter. */
  playlistId: string;
  /** AND-combined. Omit or leave empty to accept everything the global filters pass. */
  rules?: Rule[];
  /** Per-route overrides of CONFIG.filters. */
  excludeShorts?: boolean;
  minDurationMinutes?: number;
  maxDurationMinutes?: number;
  /** Set false to keep the route configured but skip it. */
  enabled?: boolean;
}

/** One item as it appears in the channel's RSS feed. */
export interface FeedEntry {
  videoId: string;
  title: string;
  publishedAt: string;
  updatedAt: string;
}

/** A candidate video, hydrated from videos.list. */
export interface Video {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number;
  /** 'none' means not currently broadcasting. A finished premiere or stream reads as 'none'. */
  liveStatus: 'none' | 'live' | 'upcoming';
  /** True if the video was ever a live broadcast, premiere or stream alike. */
  wasLiveBroadcast: boolean;
  scheduledStartTime?: string;
  url: string;
}

/**
 * add    -> insert into the playlist, then record as decided
 * reject -> do not insert, but record as decided so it is never reconsidered
 * defer  -> leave undecided; it stays in the feed and is re-evaluated next run
 */
export type Decision =
  | { kind: 'add' }
  | { kind: 'reject'; reason: string }
  | { kind: 'defer'; reason: string };

export interface RouteState {
  /** Recorded every run, for logging and future failure notifications. */
  lastRunAt?: string;
  /** Last run that finished with zero errors. */
  lastSuccessAt?: string;
  /** Video ids with a final decision. Capped at CONFIG.maxDecidedIdsPerRoute. */
  decided: string[];
}

export type State = Record<string, RouteState>;

export interface RunStats {
  added: number;
  rejected: number;
  deferred: number;
  errors: number;
}
