import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { intakeNewEmails } from '@/lib/integrations/google/sync'
import { log } from '@/lib/logger'

// Classifying new emails can take a little time (a Haiku call each); allow headroom.
export const maxDuration = 60

// POST /api/email/intake — incremental pull of new mail, triage importance, store, and return
// what to notify on now (notify) vs roll into the digest (digest). Called every ~2 min by Hermes.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  try {
    const r = await intakeNewEmails()
    log.info('email intake', { fetched: r.fetched, notify: r.notify.length, digest: r.digest.length, noise: r.noiseCount })
    return NextResponse.json(r)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('email intake failed', { error: message })
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
