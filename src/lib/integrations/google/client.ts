// Google Workspace client — scaffold for future implementation.
//
// Pattern: follow src/lib/hubspot/client.ts exactly.
// - One request() method all calls flow through
// - Per-service TokenBucket instance (NOT the shared HubSpot one)
// - GoogleError wrapping on all failures
// - log.info on every call with service, endpoint, duration
// - Exponential backoff on 429 (Google Workspace: 250 req/s quota)
//
// To implement:
// 1. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to .env.local
// 2. Implement OAuth2 token refresh in request()
// 3. Add listGmailMessages, getGmailMessage, listCalendarEvents methods
// 4. Create src/lib/integrations/google/mapper.ts for raw → internal type mapping

import { GoogleError } from '@/lib/errors'
import { log } from '@/lib/logger'
import { TokenBucket } from '@/lib/utils/rate-limiter'

// Google Workspace default quota: 250 req/s. Use 30% cap = 75 req/s.
const rateLimiter = new TokenBucket(75, 75)

const BASE = 'https://www.googleapis.com'
const MAX_RETRIES = 3

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

export class GoogleClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    attempt = 0
  ): Promise<T> {
    await rateLimiter.acquire()

    const url = `${BASE}${path}`
    const start = Date.now()

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    log.info('google api call', { method, path, status: res.status, ms: Date.now() - start })

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) throw new GoogleError('Google rate limit exceeded after retries', 429)
      await sleep(1000 * Math.pow(2, attempt))
      return this.request<T>(method, path, body, attempt + 1)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new GoogleError(`Google API error ${res.status}`, res.status, text)
    }

    return res.json() as Promise<T>
  }

  // TODO: implement when Google Workspace credentials are available
  async listGmailMessages(_query: string, _maxResults = 50): Promise<never> {
    throw new GoogleError('GoogleClient not yet implemented')
  }

  async getGmailMessage(_id: string): Promise<never> {
    throw new GoogleError('GoogleClient not yet implemented')
  }
}
