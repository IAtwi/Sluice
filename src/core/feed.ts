import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from './http.js';
import type { FeedEntry } from './types.js';

/** One fetch per channel per run, even when several routes share a channel. */
const cache = new Map<string, FeedEntry[]>();

export function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

/**
 * The channel's public RSS feed: no auth, no API key, no quota cost.
 * Always returns the ~15 most recent uploads, which is what bounds the candidate set.
 *
 * Set SLUICE_FIXTURE_DIR to read <dir>/<channelId>.xml from disk instead. Used by
 * `npm run selftest` to exercise parsing without network access.
 */
export async function fetchFeed(channelId: string): Promise<FeedEntry[]> {
  const cached = cache.get(channelId);
  if (cached) return cached;

  let xml: string;
  const fixtureDir = process.env['SLUICE_FIXTURE_DIR'];
  if (fixtureDir) {
    const file = join(fixtureDir, `${channelId}.xml`);
    if (!existsSync(file)) throw new Error(`fixture not found: ${file}`);
    xml = readFileSync(file, 'utf8');
  } else {
    const res = await request(feedUrl(channelId));
    if (!res.ok) throw new Error(`feed request failed for ${channelId}: HTTP ${res.status}`);
    xml = await res.text();
  }

  const entries = parseFeed(xml);
  cache.set(channelId, entries);
  return entries;
}

/** Deliberately a small hand parser: the feed shape is fixed and this avoids a dependency. */
export function parseFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];

  for (const chunk of xml.split('<entry>').slice(1)) {
    const block = chunk.split('</entry>')[0] ?? '';
    const videoId = pick(block, 'yt:videoId');
    if (!videoId) continue;
    entries.push({
      videoId,
      // The entry's own <title> precedes <media:title>, so the first match is correct.
      title: decodeXml(pick(block, 'title') ?? ''),
      publishedAt: pick(block, 'published') ?? '',
      updatedAt: pick(block, 'updated') ?? '',
    });
  }
  return entries;
}

function pick(block: string, tag: string): string | undefined {
  return block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
}

export function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    // Ampersand last, so "&amp;lt;" does not decode twice into "<".
    .replace(/&amp;/g, '&');
}
