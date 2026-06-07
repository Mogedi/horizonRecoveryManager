import { rateLimiter } from '@/lib/utils/rate-limiter'
import { HubSpotError } from '@/lib/errors'

const BASE = 'https://api.hubapi.com'
const MAX_RETRIES = 3

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

// All HubSpot API calls go through here — rate limiting, 429 backoff, error typing.
// Never call the HubSpot API directly anywhere else in the codebase.
export async function hubspotRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  attempt = 0
): Promise<T> {
  await rateLimiter.acquire()

  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) {
      throw new HubSpotError('Rate limit exceeded after retries', 429)
    }
    const backoffMs = 1000 * Math.pow(2, attempt)
    await sleep(backoffMs)
    return hubspotRequest<T>(method, path, body, attempt + 1)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HubSpotError(`HubSpot API error ${res.status}`, res.status, text)
  }

  return res.json() as Promise<T>
}

// ─── Typed wrappers ───────────────────────────────────────────────────────────

type SearchResponse<T> = {
  results: T[]
  paging?: { next?: { after: string } }
}

// Fetches all pages of a CRM search query.
export async function hubspotSearchAll<T>(body: object): Promise<{ results: T[]; callCount: number }> {
  const results: T[] = []
  let after: string | undefined
  let callCount = 0

  do {
    const payload = after ? { ...body, after } : body
    const page = await hubspotRequest<SearchResponse<T>>('POST', '/crm/v3/objects/deals/search', payload)
    callCount++
    results.push(...page.results)
    after = page.paging?.next?.after
  } while (after)

  return { results, callCount }
}

// GET associations for a deal: returns array of associated object IDs.
export async function getAssociationIds(dealId: string, objectType: string): Promise<string[]> {
  const res = await hubspotRequest<{ results: { id: string }[] }>(
    'GET',
    `/crm/v3/objects/deals/${dealId}/associations/${objectType}`
  )
  return res.results.map(r => r.id)
}

// GET a single object (note, task, call, email).
export async function getObject(objectType: string, objectId: string, properties: string[]): Promise<{ id: string; properties: Record<string, string | null> }> {
  return hubspotRequest<{ id: string; properties: Record<string, string | null> }>(
    'GET',
    `/crm/v3/objects/${objectType}/${objectId}?properties=${properties.join(',')}`
  )
}

// POST contacts/batch/read — fetch multiple contacts at once.
export async function batchReadContacts(ids: string[]): Promise<{ results: { id: string; properties: Record<string, string | null> }[] }> {
  return hubspotRequest<{ results: { id: string; properties: Record<string, string | null> }[] }>(
    'POST',
    '/crm/v3/objects/contacts/batch/read',
    {
      inputs: ids.map(id => ({ id })),
      properties: [
        'firstname', 'lastname', 'email',
        'phone', 'mobilephone',
        'phone_1', 'phone_2', 'phone_3', 'phone_4', 'phone_5', 'phone_6', 'phone_7',
        'phone_numbers__excess_elite', 'phone_numbers__beenverified_fastpeople_etc',
        'is_deceased', 'do_not_contact',
        'contact_type1', 'ownership_contact_status1', 'attorney1',
        'hs_object_id',
      ],
    }
  )
}
