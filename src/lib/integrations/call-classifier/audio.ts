import { OpenAIError } from '@/lib/errors'

const DOWNLOAD_TIMEOUT_MS = 45_000  // 45s — covers slow S3 redirects; wraps entire fetch + body read

// Downloads a JustCall recording URL into a Buffer (RAM only — no disk writes).
// The recording URL from raw_payload is a JustCall presigned-URL generator endpoint
// that produces a fresh S3 redirect on each authenticated request.
export async function downloadRecording(
  url: string,
  apiKey: string,
  apiSecret: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const download = async () => {
    const res = await fetch(url, {
      headers: { Authorization: `${apiKey}:${apiSecret}` },
    })

    if (!res.ok) {
      throw new OpenAIError(
        `Failed to download recording: HTTP ${res.status}`,
        res.status,
      )
    }

    const contentType = res.headers.get('content-type') ?? 'audio/wav'
    const buffer = Buffer.from(await res.arrayBuffer())

    if (buffer.length < 100) {
      throw new OpenAIError('Recording file too small to transcribe (likely empty)')
    }

    return { buffer, contentType }
  }

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new OpenAIError(`Recording download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`)),
      DOWNLOAD_TIMEOUT_MS,
    )
  )

  return Promise.race([download(), timeout])
}
