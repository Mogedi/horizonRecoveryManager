import { justcallLimiter } from '@/lib/rate-limiters'
import { JustCallError } from '@/lib/errors'
import { log } from '@/lib/logger'
import type { JustCallCallsResponse } from './types'
import type { NormalizedCallLog, PhoneProvider } from '@/lib/integrations/phone-provider'
import { normalizeJustCallRecord } from './normalize'

const BASE = 'https://api.justcall.io/v2.1'
const PER_PAGE = 100

// Format a Date as JustCall-expected datetime string: "yyyy-mm-dd hh:mm:ss"
// JustCall accepts datetimes in the account's timezone (America/New_York).
function toJustCallDatetime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

class JustCallClient implements PhoneProvider {
  private readonly apiKey: string
  private readonly apiSecret: string

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey
    this.apiSecret = apiSecret
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | boolean>,
  ): Promise<T> {
    return justcallLimiter.schedule(async () => {
      const url = new URL(`${BASE}${path}`)
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v))
      }

      const start = Date.now()
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `${this.apiKey}:${this.apiSecret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      })
      const ms = Date.now() - start

      log.info('justcall api call', { path, status: res.status, ms })

      if (res.status === 429) throw new JustCallError('Rate limited', 429)

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new JustCallError(`JustCall API error ${res.status}: ${text}`, res.status)
      }

      return res.json() as Promise<T>
    })
  }

  // Implements PhoneProvider. Fetches all calls in the given UTC range.
  // Converts UTC bounds to Eastern for the API query (JustCall expects account timezone).
  async getCallLogs(since: Date, until: Date): Promise<NormalizedCallLog[]> {
    const fromDatetime = toJustCallDatetime(since)
    const toDatetime = toJustCallDatetime(until)

    log.info('justcall fetching calls', { fromDatetime, toDatetime })

    const results: NormalizedCallLog[] = []
    let page = 1
    let totalFetched = 0

    while (true) {
      const resp = await this.request<JustCallCallsResponse>('/calls', {
        from_datetime: fromDatetime,
        to_datetime: toDatetime,
        per_page: PER_PAGE,
        page,
        sort: 'datetime',
        order: 'asc',
      })

      if (!resp.data || resp.data.length === 0) break

      for (const raw of resp.data) {
        const normalized = normalizeJustCallRecord(raw)
        if (normalized) results.push(normalized)
      }

      totalFetched += resp.data.length
      log.info('justcall page fetched', { page, count: resp.data.length, total: resp.total, normalized: results.length })

      if (resp.data.length < PER_PAGE) break
      page++
    }

    log.info('justcall fetch complete', { totalFetched, normalized: results.length })
    return results
  }
}

// Module-level singleton — reads credentials from env at call time (not module load time).
// This allows tests to mock process.env without import-time binding issues.
export function getJustCallClient(): PhoneProvider {
  const key = process.env.JUSTCALL_API_KEY
  const secret = process.env.JUSTCALL_API_SECRET
  if (!key || !secret) {
    throw new JustCallError('JUSTCALL_API_KEY and JUSTCALL_API_SECRET must be set in .env.local')
  }
  return new JustCallClient(key, secret)
}
