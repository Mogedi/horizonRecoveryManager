import { toFile } from 'openai'
import type { TranscriptionVerbose } from 'openai/resources/audio/transcriptions'
import { OpenAIError } from '@/lib/errors'
import { getOpenAIClient, withRateLimit } from './client'

const WHISPER_TIMEOUT_MS = 300_000  // 5 min — covers 9-min audio at ~3× real-time; Whisper has no duration limit, only 25MB file cap

export type TranscribeResult = {
  text: string
  durationSecs: number | null
}

// Sends an in-memory audio buffer to OpenAI Whisper and returns the full transcript.
// Language is pinned to English — avoids wasting tokens on language detection.
export async function transcribeAudio(
  buffer: Buffer,
  contentType: string,
): Promise<TranscribeResult> {
  const client = getOpenAIClient()
  const ext = contentType.includes('wav') ? 'wav' : 'mp3'
  const file = await toFile(buffer, `call.${ext}`, { type: contentType })

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new OpenAIError(`Whisper timed out after ${WHISPER_TIMEOUT_MS / 1000}s`)), WHISPER_TIMEOUT_MS)
  )

  const response = await Promise.race([
    withRateLimit(() =>
      client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'en',
        response_format: 'verbose_json',
      })
    ),
    timeoutPromise,
  ])

  const verbose = response as TranscriptionVerbose
  const text = verbose.text
  const duration = verbose.duration as number | undefined

  if (typeof text !== 'string') {
    throw new OpenAIError('Whisper returned unexpected response shape')
  }

  return {
    text: text.trim(),
    durationSecs: duration != null ? Math.round(duration) : null,
  }
}
