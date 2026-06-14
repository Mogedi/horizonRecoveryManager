import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { setDealCaseType } from '@/lib/db/deals'
import { isCaseType } from '@/lib/research/case-type'
import { log } from '@/lib/logger'

// Set a deal's case type (Horizon-managed, NOT HubSpot). Drives the research profile — whether
// property research applies. Session or agent (Hermes could tag a case later).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const { id } = await params
  let body: { caseType?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  if (!isCaseType(body.caseType)) {
    return NextResponse.json({ error: 'caseType must be one of: tax_sale, mortgage_foreclosure, state_funds, estate_sale, unknown' }, { status: 400 })
  }
  try {
    const updated = await setDealCaseType(id, body.caseType)
    return NextResponse.json(updated)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.error('set case type failed', { dealId: id, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
