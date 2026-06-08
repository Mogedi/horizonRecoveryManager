// Google OAuth token refresh — exchanges GOOGLE_REFRESH_TOKEN for a short-lived access token.
// Access tokens expire after 1 hour; we cache in-memory with a 55-minute TTL.
// This module is the single place that reads Google credentials from env.

import { GoogleError } from '@/lib/errors'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CACHE_TTL_MS = 55 * 60 * 1000  // 55 min — tokens last 60

let cachedToken: string | null = null
let cacheExpiresAt = 0

export function clearTokenCache() {
  cachedToken = null
  cacheExpiresAt = 0
}

export function isGoogleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  )
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cacheExpiresAt) return cachedToken

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new GoogleError(
      'Google credentials not configured — add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to .env.local'
    )
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GoogleError(`Token refresh failed: ${res.status}`, res.status, text)
  }

  const json = await res.json() as { access_token: string; expires_in: number }
  cachedToken = json.access_token
  cacheExpiresAt = Date.now() + CACHE_TTL_MS
  return cachedToken
}
