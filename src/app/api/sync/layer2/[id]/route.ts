import { NextRequest, NextResponse } from 'next/server'
import { runLayer2Sync, estimateLayer2Calls } from '@/lib/sync/layer2'

// GET /api/sync/layer2/[id] — returns estimated call count (shown in UI before Mo confirms)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const estimate = await estimateLayer2Calls(id)
  return NextResponse.json({ hubspotId: id, estimatedCalls: estimate })
}

// POST /api/sync/layer2/[id] — Mo clicked "Load Full Detail" and confirmed the call count
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dashboardToken = req.headers.get('x-dashboard-token')
  if (dashboardToken !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const result = await runLayer2Sync(id)
    console.log(`[layer2] deal ${id}: ${result.activitiesStored} activities, ${result.contactsStored} contacts, ${result.apiCallsMade} API calls`)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[layer2] deal ${id} failed:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
