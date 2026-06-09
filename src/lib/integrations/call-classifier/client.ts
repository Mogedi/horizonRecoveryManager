import OpenAI from 'openai'
import { openaiLimiter } from '@/lib/rate-limiters'
import { OpenAIError } from '@/lib/errors'

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
  return openaiLimiter.schedule(fn)
}
