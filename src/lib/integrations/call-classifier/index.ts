// ── Public API — import ONLY from this file, never from internals ──────────────
//
// call-classifier microservice:
//   Input:  ActivityEvent ID (outbound answered JustCall calls only)
//   Output: ClassifyResult — transcript, classification, summary stored in call_transcripts
//
// Pipeline stages (in order):
//   1. audio.ts      — download recording from JustCall (RAM only, no disk)
//   2. transcribe.ts — Whisper API → full transcript text
//   3. patterns.ts   — regex classify transcript start → live | voicemail | disconnected
//   4. summarize.ts  — Claude summary for live calls ≥ 30s
//
// To add a new analysis stage: add it to pipeline.ts. Everything else stays untouched.

import { prisma } from '@/lib/db/client'
import { upsertCallTranscript, upsertErrorTranscript } from '@/lib/db/call-transcripts'
import { runPipeline } from './pipeline'
import type { ClassifyResult, PipelineContext } from './types'

export type { ClassifyResult, CallClassification } from './types'

// Process a single activity event. Idempotent — re-running overwrites the previous result.
export async function processCall(activityEventId: number): Promise<ClassifyResult> {
  const event = await prisma.activityEvent.findUniqueOrThrow({
    where: { id: activityEventId },
    select: { externalId: true, durationSecs: true, rawPayload: true },
  })

  const p = event.rawPayload as Record<string, unknown>
  const callInfo = p?.call_info as Record<string, unknown> | undefined
  const recordingUrl = callInfo?.recording as string | undefined

  if (!recordingUrl) {
    await upsertErrorTranscript(activityEventId, 'no_recording_url')
    throw new Error(`No recording URL for activity event ${activityEventId}`)
  }

  const ctx: PipelineContext = {
    activityEventId,
    externalId: event.externalId ?? '',
    recordingUrl,
    durationSecs: event.durationSecs,
  }

  try {
    const result = await runPipeline(ctx)
    await upsertCallTranscript(result)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('413') || msg.includes('Maximum content size limit')) {
      await upsertErrorTranscript(activityEventId, 'file_too_large')
    }
    throw err
  }
}

// Process multiple calls sequentially with a delay between each to avoid hammering APIs.
// onProgress is called after each call (done count, total).
export async function batchProcessCalls(
  eventIds: number[],
  opts: {
    delayMs?: number
    onProgress?: (done: number, total: number, result: ClassifyResult | { error: string }) => void
  } = {},
): Promise<{ processed: number; failed: number; results: ClassifyResult[] }> {
  const { delayMs = 1000, onProgress } = opts
  let processed = 0
  let failed = 0
  const results: ClassifyResult[] = []

  for (let i = 0; i < eventIds.length; i++) {
    const id = eventIds[i]
    try {
      const result = await processCall(id)
      results.push(result)
      processed++
      onProgress?.(i + 1, eventIds.length, result)
    } catch (err) {
      failed++
      const error = err instanceof Error ? err.message : String(err)
      onProgress?.(i + 1, eventIds.length, { error })
    }
    if (i < eventIds.length - 1 && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }

  return { processed, failed, results }
}
