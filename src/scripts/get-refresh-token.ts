import { createServer } from 'node:http';
import { requireEnv } from '../core/env.js';

/**
 * One-time local OAuth flow. Run this on your own machine, not the VPS.
 * Prints a refresh token to paste into .env as GOOGLE_REFRESH_TOKEN.
 */
const PORT = 8888;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/youtube';

const clientId = requireEnv('GOOGLE_CLIENT_ID');
const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    // Both are required to be handed a refresh token rather than only an access token.
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

console.log('\n1. Open this URL and approve access:\n');
console.log(authUrl);
console.log('\n   You will see a "Google hasn\'t verified this app" screen.');
console.log('   Click Advanced, then "Go to Sluice (unsafe)". That is expected for a personal app.');
console.log(`\n2. Waiting for the redirect on ${REDIRECT_URI} ...\n`);

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', REDIRECT_URI);
    if (url.pathname === '/favicon.ico') {
      res.statusCode = 404;
      res.end();
      return;
    }

    const error = url.searchParams.get('error');
    if (error) {
      res.end(`Sluice: authorization failed (${error}). You can close this tab.`);
      console.error(`\nAuthorization failed: ${error}\n`);
      server.close();
      process.exitCode = 1;
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      res.statusCode = 400;
      res.end('Sluice: no authorization code in the request.');
      return;
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      const json = (await tokenRes.json()) as { refresh_token?: string; error?: string; error_description?: string };

      if (!tokenRes.ok || !json.refresh_token) {
        res.end('Sluice: token exchange failed. Check the terminal.');
        console.error('\nToken exchange failed:', JSON.stringify(json, null, 2));
        console.error(
          '\nIf refresh_token is missing, revoke the app at https://myaccount.google.com/permissions ' +
            'and run `npm run auth` again.\n',
        );
        process.exitCode = 1;
        return;
      }

      res.end('Sluice: authorization complete. You can close this tab.');
      console.log('\n=== GOOGLE_REFRESH_TOKEN ===\n');
      console.log(json.refresh_token);
      console.log('\nAdd that line to .env, then run `npm run init`.\n');
    } catch (err) {
      res.end('Sluice: token exchange failed. Check the terminal.');
      console.error('\nToken exchange error:', err);
      process.exitCode = 1;
    } finally {
      server.close();
      setTimeout(() => process.exit(process.exitCode ?? 0), 250);
    }
  })();
});

server.listen(PORT);
