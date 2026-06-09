import { hubspotLimiter } from '@/lib/rate-limiters'
import { HubSpotError } from '@/lib/errors'

const BASE = 'https://api.hubapi.com'

// All HubSpot API calls go through here — rate limiting, 429 backoff, error typing.
// Never call the HubSpot API directly anywhere else in the codebase.
// 429 retry is handled by hubspotLimiter's 'failed' event (2s backoff, up to 3 retries).
export async function hubspotRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  return hubspotLimiter.schedule(async () => {
    const url = path.startsWith('http') ? path : `${BASE}${path}`
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (res.status === 429) throw new HubSpotError('Rate limited', 429)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HubSpotError(`HubSpot API error ${res.status}`, res.status, text)
    }

    return res.json() as Promise<T>
  })
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

// POST /crm/v3/objects/{type}/batch/read — fetch multiple CRM objects at once.
// Works for notes, tasks, calls, emails, contacts, deals, etc.
// Use this instead of per-object getObject() calls to avoid N+1 API call patterns.
export async function batchReadObjects(
  objectType: string,
  ids: string[],
  properties: string[]
): Promise<{ results: { id: string; properties: Record<string, string | null> }[] }> {
  return hubspotRequest<{ results: { id: string; properties: Record<string, string | null> }[] }>(
    'POST',
    `/crm/v3/objects/${objectType}/batch/read`,
    { inputs: ids.map(id => ({ id })), properties }
  )
}

// POST contacts/batch/read — fetch multiple contacts at once.
export async function batchReadContacts(ids: string[]): Promise<{ results: { id: string; properties: Record<string, string | null> }[] }> {
  return batchReadObjects('contacts', ids, [
    'firstname', 'lastname', 'email',
    'phone', 'mobilephone',
    'phone_1', 'phone_2', 'phone_3', 'phone_4', 'phone_5', 'phone_6', 'phone_7',
    'phone_numbers__excess_elite', 'phone_numbers__beenverified_fastpeople_etc',
    'is_deceased', 'do_not_contact',
    'contact_type1', 'ownership_contact_status1', 'attorney1',
    'hs_object_id',
  ])
}
