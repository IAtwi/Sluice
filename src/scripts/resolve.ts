import { loadEnv } from '../core/env.js';
import { resolveHandle } from '../core/youtube.js';

/** Usage: npm run resolve @kenforrest   (costs 1 quota unit) */
const handle = process.argv[2];

if (!handle) {
  console.error('usage: npm run resolve @channelhandle');
  process.exit(1);
}

loadEnv();

resolveHandle(handle)
  .then((result) => {
    if (!result) {
      console.error(`No channel found for ${handle}`);
      process.exit(1);
    }
    console.log(`\n${result.title}`);
    console.log(`channelId: ${result.id}`);
    console.log(`feed:      https://www.youtube.com/feeds/videos.xml?channel_id=${result.id}\n`);
  })
  .catch((err: unknown) => {
    console.error('resolve failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
