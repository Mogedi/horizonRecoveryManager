import OpenAI from 'openai'
import { TokenBucket } from '@/lib/utils/rate-limiter'
import { OpenAIError } from '@/lib/errors'

// 500 req/min Whisper limit — cap at 30% = 150/min = 2.5/s
const bucket = new TokenBucket(2.5, 2.5)

let _client: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new OpenAIError('OPENAI_API_KEY is not set')
    _client = new OpenAI({ apiKey })
  }
  return _client
}

export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  await bucket.acquire()
  return fn()
}
