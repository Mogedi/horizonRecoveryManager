import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { streamBriefingGeneration } from '@/lib/ai/briefing'
import { AIError } from '@/lib/ai/errors'
import { log } from '@/lib/logger'

// Allow up to 60s — briefing generation with streaming can take 20-40s
export const maxDuration = 60

export async function POST() {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  log.info('daily briefing requested')

  try {
    const stream = await streamBriefingGeneration()
    log.info('daily briefing stream started')
    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err) {
    if (err instanceof AIError) {
      log.error('daily briefing failed', { error: err.message })
      return Response.json({ error: err.message }, { status: 502 })
    }
    throw err
  }
}
