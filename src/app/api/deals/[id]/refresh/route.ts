import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { refreshDeal } from '@/lib/sync/refresh-case'
import { log } from '@/lib/logger'

// Combined per-case pull (Layer 2 + targeted JustCall + targeted Gmail) — allow time.
export const maxDuration = 60

// POST /api/deals/[id]/refresh?force=1 — pull the latest for one case from all 3 sources.
// Freshness-gated (skips if refreshed within the TTL) unless force=1.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === '1'
  try {
    const result = await refreshDeal(id, { force })
    log.info('case refresh', { dealId: id, skipped: result.skipped })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
