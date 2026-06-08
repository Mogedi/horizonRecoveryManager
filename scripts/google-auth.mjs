#!/usr/bin/env node
/**
 * One-time script to obtain a Google OAuth 2.0 refresh token.
 *
 * Run ONCE after setting up your Google Cloud project:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs
 *
 * Then add the printed GOOGLE_REFRESH_TOKEN to .env.local.
 *
 * Prerequisites in Google Cloud Console:
 *   - OAuth consent screen User type: Internal (Google Workspace org)
 *   - OAuth client: Authorized redirect URIs includes http://localhost:9999
 */

import { createServer } from 'http'

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before running.')
  process.exit(1)
}

const PORT = 9999
const REDIRECT_URI = `http://localhost:${PORT}`

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
]

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  })

console.log('\n─── Google OAuth Setup ────────────────────────────────────────────────\n')
console.log('Open this URL in your browser:\n')
console.log(authUrl)
console.log('\nWaiting for Google to redirect back to localhost:9999 ...\n')

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.end(`<h2>Error: ${error}</h2><p>Check the terminal.</p>`)
    console.error('\nGoogle returned an error:', error)
    server.close()
    process.exit(1)
  }

  if (!code) {
    res.end('<p>No code received.</p>')
    return
  }

  res.end('<h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p>')

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  const json = await tokenRes.json()
  server.close()

  if (!tokenRes.ok || !json.refresh_token) {
    console.error('\nFailed to get tokens:', JSON.stringify(json, null, 2))
    if (!json.refresh_token) {
      console.error('\nNo refresh_token in response.')
      console.error('Go to https://myaccount.google.com/permissions, revoke this app, and re-run.')
    }
    process.exit(1)
  }

  console.log('\n─── Success ────────────────────────────────────────────────────────────\n')
  console.log('Add these to .env.local:\n')
  console.log(`GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}`)
  console.log(`GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}`)
  console.log(`GOOGLE_REFRESH_TOKEN=${json.refresh_token}`)
  console.log('\nNever commit .env.local to git.\n')
})

server.listen(PORT, () => {
  // Server is ready — URL was already printed above
})
