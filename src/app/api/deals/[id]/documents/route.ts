import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { listDealDocuments } from '@/lib/integrations/google/drive-read'

type Params = { params: Promise<{ id: string }> }

// GET /api/deals/[id]/documents — list a deal's indexed Drive files (id, name, type).
export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const { id } = await params
  try {
    const r = await listDealDocuments(id)
    return NextResponse.json({ count: r.documents.length, ...r })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
