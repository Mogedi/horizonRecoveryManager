import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { runLayer2Sync } from '@/lib/sync/layer2'
import { log } from '@/lib/logger'

// GET /api/sync/layer2/[id] — returns call range shown in confirmation dialog before Mo pulls
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json({
    hubspotId: id,
    callRangeMessage: '5–50+ API calls depending on deal activity. Actual count shown after load.',
  })
}

// POST /api/sync/layer2/[id] — Mo clicked "Load Full Detail" and confirmed the call count
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()

  const { id } = await params

  try {
    const result = await runLayer2Sync(id)
    log.info('layer2 sync complete', { dealId: id, ...result })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('layer2 sync failed', { dealId: id, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
