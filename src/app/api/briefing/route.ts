import { NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { runBriefingGeneration } from '@/lib/ai/briefing'
import { AIError } from '@/lib/ai/errors'
import { log } from '@/lib/logger'

export async function POST() {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  log.info('daily briefing requested')

  try {
    const briefing = await runBriefingGeneration()
    log.info('daily briefing complete')
    return NextResponse.json({ briefing })
  } catch (err) {
    if (err instanceof AIError) {
      log.error('daily briefing failed', { error: err.message })
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    throw err
  }
}
