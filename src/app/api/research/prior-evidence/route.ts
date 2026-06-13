import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { getPriorEvidenceByName } from '@/lib/db/research'

// GET ?name=Norman Taylor → contact data we ALREADY hold for that person (from prior evidence packages).
// Hermes consults this BEFORE any paid Browser Use search and reuses what's here instead of paying again.
// Read-only; returns matches with their age (the agent judges staleness — we don't skip for it).
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const name = req.nextUrl.searchParams.get('name')?.trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const withinDaysParam = Number(req.nextUrl.searchParams.get('withinDays'))
  const withinDays = Number.isFinite(withinDaysParam) && withinDaysParam > 0 ? withinDaysParam : undefined
  return NextResponse.json(await getPriorEvidenceByName(name, withinDays))
}
