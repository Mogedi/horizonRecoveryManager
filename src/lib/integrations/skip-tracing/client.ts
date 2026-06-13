// Skip-tracing provider client — scaffold for future implementation.
//
// Pattern: follow src/lib/hubspot/client.ts exactly.
// - One request() method all calls flow through
// - Use skipTracingLimiter from src/lib/rate-limiters.ts (update limits when provider chosen)
// - SkipTracingError wrapping on all failures
// - log.info on every call with service, endpoint, duration
// - Throw on 429 — skipTracingLimiter's 'failed' event handles retry automatically
//
// To implement:
// 1. Choose provider (e.g. BeenVerified, TLO, IDI, DataTree)
// 2. Add SKIP_TRACING_API_KEY to .env.local + Vercel
// 3. Update skipTracingLimiter in src/lib/rate-limiters.ts with real rate limits
// 4. Implement provider-specific auth + endpoint paths
// 5. Create src/lib/integrations/skip-tracing/mapper.ts for raw → internal type mapping
// 6. Internal type: { name, phones: string[], emails: string[], address, deceased: boolean }

import { SkipTracingError } from '@/lib/errors'
import { log } from '@/lib/logger'
import { skipTracingLimiter } from '@/lib/rate-limiters'

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
  ): Promise<T> {
    return skipTracingLimiter.schedule(async () => {
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

      if (res.status === 429) throw new SkipTracingError('Rate limited', 429)

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new SkipTracingError(`Skip-tracing API error ${res.status}`, res.status, text)
      }

      return res.json() as Promise<T>
    })
  }

  // TODO: implement when provider is chosen and API key is available
  async lookupByName(name: string, address?: string): Promise<never> {
    void name
    void address
    throw new SkipTracingError('SkipTracingClient not yet implemented')
  }
}
