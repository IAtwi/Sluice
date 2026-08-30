import { requireEnv } from './env.js';
import { HttpError, requestJson } from './http.js';
import type { Video } from './types.js';

const API = 'https://www.googleapis.com/youtube/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** One token exchange per process. The process is short lived, so no expiry handling is needed. */
let cachedAccessToken: string | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;

  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });

  try {
    const json = await requestJson<{ access_token: string }>(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    cachedAccessToken = json.access_token;
    return json.access_token;
  } catch (err) {
    if (err instanceof HttpError && err.body.includes('invalid_grant')) {
      throw new Error(
        'Refresh token rejected (invalid_grant). The usual cause is an OAuth consent screen still in ' +
          '"Testing" mode, where refresh tokens expire after 7 days. Publish the app to Production in the ' +
          'Google Cloud Console, then run `npm run auth` again to mint a new token.',
      );
    }
    throw err;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

interface ApiVideo {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    liveBroadcastContent?: string;
  };
  contentDetails?: { duration?: string };
  liveStreamingDetails?: { scheduledStartTime?: string; actualStartTime?: string; actualEndTime?: string };
}

/**
 * Hydrates candidate ids. Batched 50 at a time, 1 quota unit per batch.
 * Ids the API does not return (deleted, private, region blocked) are simply absent.
 */
export async function getVideos(ids: string[]): Promise<Map<string, Video>> {
  const out = new Map<string, Video>();
  if (ids.length === 0) return out;
  const token = await getAccessToken();

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url =
      `${API}/videos?part=snippet,contentDetails,liveStreamingDetails` +
      `&maxResults=50&id=${chunk.map(encodeURIComponent).join(',')}`;
    const json = await requestJson<{ items?: ApiVideo[] }>(url, { headers: authHeaders(token) });
    for (const item of json.items ?? []) out.set(item.id, toVideo(item));
  }
  return out;
}

function toVideo(item: ApiVideo): Video {
  const live = item.snippet?.liveBroadcastContent;
  const liveStatus: Video['liveStatus'] = live === 'live' || live === 'upcoming' ? live : 'none';
  return {
    id: item.id,
    title: item.snippet?.title ?? '',
    description: item.snippet?.description ?? '',
    channelId: item.snippet?.channelId ?? '',
    channelTitle: item.snippet?.channelTitle ?? '',
    publishedAt: item.snippet?.publishedAt ?? '',
    durationSeconds: parseIsoDuration(item.contentDetails?.duration),
    liveStatus,
    wasLiveBroadcast: item.liveStreamingDetails !== undefined,
    ...(item.liveStreamingDetails?.scheduledStartTime
      ? { scheduledStartTime: item.liveStreamingDetails.scheduledStartTime }
      : {}),
    url: `https://www.youtube.com/watch?v=${item.id}`,
  };
}

/** ISO 8601 duration, e.g. PT1H2M3S. Returns 0 for live content, which reports PT0S. */
export function parseIsoDuration(iso: string | undefined): number {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/);
  if (!m) return 0;
  return (
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3] ?? 0) * 60 +
    Math.round(Number(m[4] ?? 0))
  );
}

/**
 * Costs 1 quota unit and makes duplicates impossible from any cause: a failed insert
 * that actually succeeded, a manually added video, or a deleted state.json.
 */
export async function isInPlaylist(playlistId: string, videoId: string): Promise<boolean> {
  const token = await getAccessToken();
  const url =
    `${API}/playlistItems?part=id&maxResults=1` +
    `&playlistId=${encodeURIComponent(playlistId)}&videoId=${encodeURIComponent(videoId)}`;
  const json = await requestJson<{ items?: unknown[] }>(url, { headers: authHeaders(token) });
  return (json.items?.length ?? 0) > 0;
}

/** 50 quota units. Never retried: a blind retry on a 5xx risks a duplicate entry. */
export async function addToPlaylist(playlistId: string, videoId: string): Promise<void> {
  const token = await getAccessToken();
  await requestJson(
    `${API}/playlistItems?part=snippet`,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
      }),
    },
    { retries: 0 },
  );
}

/** Resolves an @handle to a UC... channel id. 1 quota unit. */
export async function resolveHandle(handle: string): Promise<{ id: string; title: string } | null> {
  const token = await getAccessToken();
  const normalized = handle.startsWith('@') ? handle : `@${handle}`;
  const url = `${API}/channels?part=id,snippet&forHandle=${encodeURIComponent(normalized)}`;
  const json = await requestJson<{ items?: { id: string; snippet?: { title?: string } }[] }>(url, {
    headers: authHeaders(token),
  });
  const first = json.items?.[0];
  return first ? { id: first.id, title: first.snippet?.title ?? '' } : null;
}
