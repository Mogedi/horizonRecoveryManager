// Resolve a US county from a street address via the FREE US Census geocoder (no API key).
// qPublic is organized BY COUNTY, but Mo works from an address — so we derive the county first.
interface CensusResponse {
  result?: {
    addressMatches?: Array<{
      addressComponents?: { state?: string }
      geographies?: { Counties?: Array<{ BASENAME?: string; NAME?: string }> }
    }>
  }
}

export interface CountyResult {
  county: string // e.g. "Upson"
  state: string // 2-letter, e.g. "GA"
}

export async function resolveCounty(
  address: string,
  opts: { signal?: AbortSignal } = {},
): Promise<CountyResult | null> {
  const url =
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress' +
    `?address=${encodeURIComponent(address)}` +
    '&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json'
  try {
    const res = await fetch(url, { signal: opts.signal })
    if (!res.ok) return null
    const j = (await res.json()) as CensusResponse
    const match = j.result?.addressMatches?.[0]
    const county = match?.geographies?.Counties?.[0]
    const name = county?.BASENAME ?? county?.NAME
    if (!name) return null
    return {
      county: name.replace(/\s+county$/i, '').trim(),
      state: (match?.addressComponents?.state ?? '').trim(),
    }
  } catch {
    return null
  }
}
