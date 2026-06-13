import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { saveCost } from '@/lib/db/research'

// The worker syncs per-run cost here (one Hermes session = one run). Deduped by sessionId.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  let body: { sessionId?: string; requestId?: number; model?: string; inTokens?: number; outTokens?: number; usd?: number; runSeconds?: number; firecrawlCalls?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  await saveCost(body)
  return NextResponse.json({ ok: true })
}
