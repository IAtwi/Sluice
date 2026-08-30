import type { Route } from '../core/types.js';

/**
 * Ken (@kenforrest), Clash Royale.
 * No content rules: every ordinary upload goes to the playlist.
 * Shorts and in-progress live content are handled by the global filters in src/config.ts.
 */
export const ken: Route = {
  id: 'ken',
  label: 'Ken (@kenforrest)',
  channelId: 'UCiFOL6V9KbvxfXvzdFSsqCw',

  // Playlist "Sluice_CR" (private). Verify with: npm run check
  playlistId: 'PLdoqNGbOIGUI',

  rules: [],
};
