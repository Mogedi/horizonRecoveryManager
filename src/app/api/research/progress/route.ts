import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { logProgress, saveCost } from '@/lib/db/research'

// Hermes narrates progress here as it works (shown live in the dashboard). Also accepts a per-run
// cost record. Both are observability — neither is a business object.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  let body: { requestId?: number; message?: string; step?: string; cost?: { model?: string; inTokens?: number; outTokens?: number; firecrawlCalls?: number; usd?: number; runSeconds?: number } }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

  if (body.cost) { await saveCost({ requestId: body.requestId, ...body.cost }); return NextResponse.json({ ok: true }) }
  if (!body.message) return NextResponse.json({ error: 'message or cost required' }, { status: 400 })
  await logProgress(body.requestId, body.message, body.step)
  return NextResponse.json({ ok: true })
}
