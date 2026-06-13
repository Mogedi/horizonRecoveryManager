import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { logProgress } from '@/lib/db/research'

// Hermes narrates progress here as it works (shown live in the dashboard). Observability, not a business object.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  let body: { requestId?: number; message?: string; step?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.requestId || !body.message) return NextResponse.json({ error: 'requestId and message required' }, { status: 400 })
  await logProgress(body.requestId, body.message, body.step)
  return NextResponse.json({ ok: true })
}
