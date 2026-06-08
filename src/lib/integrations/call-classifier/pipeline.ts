import { downloadRecording } from './audio'
import { transcribeAudio } from './transcribe'
import { classifyTranscript } from './patterns'
import { summarizeTranscript } from './summarize'
import type { PipelineContext, ClassifyResult } from './types'

// Minimum conversation length to bother generating an AI summary.
// Voicemail greetings + Kathleen's message typically run 20–35s.
// A real conversation is usually 30s+, so this threshold avoids summarizing
// short voicemail drops that Whisper classified as 'live' due to faint audio.
const MIN_LIVE_SECS_FOR_SUMMARY = 30

export async function runPipeline(ctx: PipelineContext): Promise<ClassifyResult> {
  const apiKey = process.env.JUSTCALL_API_KEY!
  const apiSecret = process.env.JUSTCALL_API_SECRET!

  // Stage 1 — Download audio into RAM
  const { buffer, contentType } = await downloadRecording(ctx.recordingUrl, apiKey, apiSecret)

  // Stage 2 — Transcribe (full text stored regardless of classification)
  const { text: transcript, durationSecs: whisperSecs } = await transcribeAudio(buffer, contentType)

  // Stage 3 — Classify from transcript (first 300 chars + patterns)
  const classification = classifyTranscript(transcript)

  // Stage 4 — Summarize live calls that are long enough to contain real content
  let summary: string | null = null
  const effectiveDuration = whisperSecs ?? ctx.durationSecs ?? 0
  if (classification === 'live' && effectiveDuration >= MIN_LIVE_SECS_FOR_SUMMARY) {
    try {
      summary = await summarizeTranscript(transcript)
    } catch {
      // Summary failure is non-fatal — transcript + classification still stored
      summary = null
    }
  }

  return {
    activityEventId: ctx.activityEventId,
    classification,
    transcript,
    summary,
    whisperSecs: whisperSecs ?? null,
  }
}
