import { callClaude } from '@/lib/ai/client'

const SYSTEM_PROMPT = `You summarize phone call transcripts between a case manager (Kathleen) and a property owner or heir regarding unclaimed surplus funds from a Georgia tax sale.

Rules:
- 2–3 sentences maximum
- Focus on: what the contact said, their level of interest or concern, any next steps mentioned
- If the contact was unresponsive or hostile, note that briefly
- Do not invent information not present in the transcript
- Do not mention Kathleen by name — refer to her as "the caller"
- Output plain text only — no bullet points, no markdown`

const CLAUDE_TIMEOUT_MS = 30_000

// Generates a 2–3 sentence summary of a live call transcript using Claude.
// Only called for calls classified as 'live' with durationSecs >= 30.
export async function summarizeTranscript(transcript: string): Promise<string> {
  const prompt = `Transcript:\n\n${transcript}\n\nSummarize this call in 2–3 sentences.`

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Claude summarization timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`)), CLAUDE_TIMEOUT_MS)
  )

  const response = await Promise.race([callClaude(prompt, SYSTEM_PROMPT), timeoutPromise])
  return response.trim()
}
