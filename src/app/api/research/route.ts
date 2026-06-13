import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { findPerson } from '@/lib/research/find-person'
import type { PersonQuery } from '@/lib/research/types'
import { log } from '@/lib/logger'

// Browser research can take a while (multiple sources, each a real page load + extraction).
export const maxDuration = 60

// POST { name, address?, city?, state?, parcelId?, county?, ageHint?, relativesHint?, caseId? }
// → the dossier (resolution + candidates + per-source telemetry). Session OR Hermes agent.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()

  let body: Partial<PersonQuery>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const query: PersonQuery = {
    name: body.name.trim(),
    address: body.address?.trim() || undefined,
    city: body.city?.trim() || undefined,
    state: body.state?.trim() || 'GA',
    parcelId: body.parcelId?.trim() || undefined,
    county: body.county?.trim() || undefined,
    ageHint: typeof body.ageHint === 'number' ? body.ageHint : undefined,
    relativesHint: Array.isArray(body.relativesHint) ? body.relativesHint.filter(r => typeof r === 'string') : undefined,
    caseId: body.caseId ?? null,
  }

  try {
    const { dossier, dossierId, skipped } = await findPerson(query)
    return NextResponse.json({ dossierId, skipped, ...dossier })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.error('research find_person failed', { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
