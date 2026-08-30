import { request } from './http.js';

/**
 * Duration alone is no longer conclusive: Shorts can run up to 3 minutes.
 * A real Short renders at youtube.com/shorts/<id> and returns 200.
 * A normal video redirects to /watch?v=<id>.
 *
 * Unofficial but free, with no quota cost. Disable via CONFIG.filters.verifyShortsViaUrl.
 */
export async function isShort(videoId: string): Promise<boolean> {
  const res = await request(
    `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`,
    { redirect: 'manual' },
    { retries: 1 },
  );
  return res.status === 200;
}
