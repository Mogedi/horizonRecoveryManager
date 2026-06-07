// Skip-tracing provider client — scaffold for future implementation.
//
// Pattern: follow src/lib/hubspot/client.ts exactly.
// - One request() method all calls flow through
// - Per-service TokenBucket instance
// - SkipTracingError wrapping on all failures
// - log.info on every call with service, endpoint, duration
// - Exponential backoff on rate limit responses
//
// To implement:
// 1. Choose provider (e.g. BeenVerified, TLO, IDI, DataTree)
// 2. Add SKIP_TRACING_API_KEY to .env.local + Vercel
// 3. Implement provider-specific auth + endpoint paths
// 4. Create src/lib/integrations/skip-tracing/mapper.ts for raw → internal type mapping
// 5. Internal type: { name, phones: string[], emails: string[], address, deceased: boolean }

import { SkipTracingError } from '@/lib/errors'
import { log } from '@/lib/logger'
import { TokenBucket } from '@/lib/utils/rate-limiter'

// Provider-specific rate limit — update when provider is chosen.
// Placeholder: 5 req/s
const rateLimiter = new TokenBucket(5, 5)

const MAX_RETRIES = 3

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

export class SkipTracingClient {
  private readonly baseUrl: string

  constructor(private readonly apiKey: string, baseUrl?: string) {
    // Provider base URL — set when provider is chosen
    this.baseUrl = baseUrl ?? 'https://api.provider.example.com'
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    attempt = 0
  ): Promise<T> {
    await rateLimiter.acquire()

    const url = `${this.baseUrl}${path}`
    const start = Date.now()

    const res = await fetch(url, {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    log.info('skip-tracing api call', { method, path, status: res.status, ms: Date.now() - start })

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) throw new SkipTracingError('Rate limit exceeded after retries', 429)
      await sleep(1000 * Math.pow(2, attempt))
      return this.request<T>(method, path, body, attempt + 1)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new SkipTracingError(`Skip-tracing API error ${res.status}`, res.status, text)
    }

    return res.json() as Promise<T>
  }

  // TODO: implement when provider is chosen and API key is available
  async lookupByName(_name: string, _address?: string): Promise<never> {
    throw new SkipTracingError('SkipTracingClient not yet implemented')
  }
}
