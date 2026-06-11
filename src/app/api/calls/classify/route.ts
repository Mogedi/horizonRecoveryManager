import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { getUnclassifiedAnsweredCallIds, countUnclassifiedAnsweredCalls } from '@/lib/db/call-transcripts'
import { batchProcessCalls } from '@/lib/integrations/call-classifier'
import { log } from '@/lib/logger'

// Whisper + Claude per call can take several seconds; cap the batch so we stay under the limit.
export const maxDuration = 60

// POST /api/calls/classify — transcribe + classify a CHUNK of un-transcribed answered calls.
// Designed to be called in a loop by the Hermes nightly job: it returns `remaining` so the
// caller keeps invoking until `done`. Chunked because Whisper transcription is slow and the
// Vercel function budget is 60s. Loop-safe: oversized/failed calls get an error transcript and
// drop out of the queue, so `remaining` strictly decreases.
//
// Body: { limit?: number }  — calls to process this invocation (default 6, max 12 to fit 60s).
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()

  const body = await req.json().catch(() => ({}))
  const limit = Math.min(Math.max(Number(body.limit) || 6, 1), 12)

  const ids = await getUnclassifiedAnsweredCallIds(limit)
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, failed: 0, remaining: 0, done: true, classifications: {} })
  }

  log.info('call classify batch starting', { count: ids.length })

  try {
    const errorSamples: string[] = []
    const { processed, failed, results } = await batchProcessCalls(ids, {
      delayMs: 250,
      onProgress: (_done, _total, r) => {
        if ('error' in r && errorSamples.length < 3) errorSamples.push(r.error)
      },
    })

    // Tally classifications so the nightly summary can report live/voicemail/etc.
    const classifications: Record<string, number> = {}
    for (const r of results) classifications[r.classification] = (classifications[r.classification] ?? 0) + 1

    const remaining = await countUnclassifiedAnsweredCalls()
    log.info('call classify batch complete', { processed, failed, remaining, classifications, errorSamples })

    return NextResponse.json({
      ok: true,
      processed,
      failed,
      remaining,
      done: remaining === 0,
      classifications,
      ...(errorSamples.length ? { errorSamples } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('call classify batch failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

// GET /api/calls/classify — backlog status (how many calls still need transcription).
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const remaining = await countUnclassifiedAnsweredCalls()
  return NextResponse.json({ remaining, done: remaining === 0 })
}
