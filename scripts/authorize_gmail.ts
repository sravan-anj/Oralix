/**
 * One-Time Gmail Authorization Script for Dentiflow Clinic Setup
 * 
 * Purpose:
 * Run this CLI script ONCE during initial clinic onboarding or development setup
 * to obtain the permanent Google OAuth `refresh_token`.
 * 
 * Usage:
 *   npx tsx scripts/authorize_gmail.ts
 * 
 * Flow:
 * 1. Prompts for your Google Client ID and Google Client Secret (from Google Cloud Console).
 * 2. Generates the Google OAuth authorization URL (with offline access & prompt=consent).
 * 3. Starts a temporary local HTTP server on port 8085 to catch the redirect callback.
 * 4. Exchanges the authorization code for the permanent `refresh_token`.
 * 5. Prints the exact Supabase CLI command to store the secrets securely in Supabase.
 * 
 * Security:
 * - Credentials are only kept in memory during the execution of this script.
 * - Nothing is written to disk or git.
 */

import http from 'http';
import readline from 'readline';

const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function promptInput(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function main() {
  console.log('\n======================================================');
  console.log('  🦷 Dentiflow Clinic Gmail One-Time Authorization');
  console.log('======================================================\n');
  console.log('This helper will generate the Google OAuth Refresh Token for Dentiflow.');
  console.log('Before continuing, ensure:');
  console.log('1. You created a Web Application OAuth Client in Google Cloud Console.');
  console.log(`2. Added "${REDIRECT_URI}" to Authorized Redirect URIs.\n`);

  const clientId = await promptInput('Enter GOOGLE_CLIENT_ID: ');
  if (!clientId) {
    console.error('Error: GOOGLE_CLIENT_ID is required.');
    process.exit(1);
  }

  const clientSecret = await promptInput('Enter GOOGLE_CLIENT_SECRET: ');
  if (!clientSecret) {
    console.error('Error: GOOGLE_CLIENT_SECRET is required.');
    process.exit(1);
  }

  // Construct Google OAuth URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GMAIL_SEND_SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // Forces refresh token issuance

  console.log('\n👉 Open the following URL in your browser and authorize the clinic Gmail account:\n');
  console.log(authUrl.toString());
  console.log(`\nWaiting for authorization callback on ${REDIRECT_URI} ...\n`);

  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/callback')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const callbackUrl = new URL(req.url, `http://localhost:${PORT}`);
    const code = callbackUrl.searchParams.get('code');
    const error = callbackUrl.searchParams.get('error');

    if (error || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h2>Authorization Failed: ${error || 'Missing code'}</h2><p>You can close this tab.</p>`);
      console.error(`Authorization rejected by user or Google: ${error}`);
      server.close();
      process.exit(1);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Authorization Successful!</h2><p>You may return to your terminal. This tab can be closed.</p>');

    server.close();

    try {
      console.log('Exchanging authorization code with Google OAuth endpoint...');
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

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.refresh_token) {
        console.error('Failed to obtain refresh token from Google:', tokenData);
        process.exit(1);
      }

      const refreshToken = tokenData.refresh_token;

      console.log('\n======================================================');
      console.log('  🎉 Clinic Gmail Authorization Complete!');
      console.log('======================================================\n');
      console.log('Run the following Supabase CLI command to securely set the secrets in your project:\n');
      console.log(`supabase secrets set GOOGLE_CLIENT_ID="${clientId}" GOOGLE_CLIENT_SECRET="${clientSecret}" GOOGLE_REFRESH_TOKEN="${refreshToken}"\n`);
      console.log('Or add them to your Supabase Dashboard:');
      console.log('Project Settings -> Edge Functions -> Secrets\n');
      console.log('Keep these credentials private and DO NOT commit them to git.\n');
    } catch (err: any) {
      console.error('Error during token exchange:', err.message || err);
      process.exit(1);
    }
  });

  server.listen(PORT);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
