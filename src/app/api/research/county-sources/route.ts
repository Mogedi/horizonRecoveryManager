import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { getCountySources, upsertCountySource } from '@/lib/db/research'
import type { CountySourceInput } from '@/lib/research/types'

const KINDS = ['property', 'deed', 'probate', 'obituary']
const METHODS = ['gis_api', 'qpublic', 'custom_site', 'propertyradar']

// GET ?state=GA&county=Gordon → the verified registry Hermes consults before searching blind.
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const state = req.nextUrl.searchParams.get('state') ?? 'GA'
  const county = req.nextUrl.searchParams.get('county') ?? undefined
  return NextResponse.json({ sources: await getCountySources(state, county) })
}

// POST → Hermes records a newly-confirmed working method (the durable learning, not memory).
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  let body: Partial<CountySourceInput>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.state || !body.county || !KINDS.includes(body.sourceKind ?? '') || !METHODS.includes(body.method ?? '') || !body.entryUrl) {
    return NextResponse.json({ error: 'state, county, sourceKind, method, entryUrl required' }, { status: 400 })
  }
  const row = await upsertCountySource({
    state: body.state, county: body.county, sourceKind: body.sourceKind as CountySourceInput['sourceKind'],
    method: body.method as CountySourceInput['method'], entryUrl: body.entryUrl, searchHint: body.searchHint ?? '',
  })
  return NextResponse.json({ id: row.id })
}
