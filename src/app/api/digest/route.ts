import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { generateBriefingText } from '@/lib/ai/briefing'
import { AIError } from '@/lib/ai/errors'
import { log } from '@/lib/logger'

// Briefing generation can take 20-40s.
export const maxDuration = 60

// POST /api/digest — non-streamed morning briefing as plain text { text }.
// Agent-callable (HERMES_TOKEN) so the Hermes 7:45 AM job can post it to Discord.
// This is the SAME content as the dashboard's streaming briefing, just returned whole.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()

  log.info('digest requested')
  try {
    const text = await generateBriefingText()
    log.info('digest generated', { chars: text.length })
    return NextResponse.json({ ok: true, text })
  } catch (err) {
    if (err instanceof AIError) {
      log.error('digest failed', { error: err.message })
      return NextResponse.json({ ok: false, error: err.message }, { status: 502 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('digest failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
