// Centralised Bottleneck instances — one per external service.
//
// IMPORTANT — Vercel serverless limitation:
// These limiters are in-memory and per-invocation. Each serverless function starts fresh
// and has its own instance. They do NOT coordinate across concurrent Vercel invocations.
// Client-side concurrency controls (e.g., BulkVerifyPanel CONCURRENCY) remain essential
// for cross-request coordination. Before AWS/multi-instance migration: switch to
// Bottleneck's clustering mode (ioredis adapter) — same API, shared state across pods.
//
// Adding a new integration: create a limiter here + call retryOnRateLimit() on it.
// Changing a limit: one line change here, nothing else in the codebase changes.

import Bottleneck from 'bottleneck'
import { log } from '@/lib/logger'

// Attaches a 'failed' event: returns a retry delay (ms) for rate-limit errors,
// undefined for everything else (propagates immediately without retry).
function retryOnRateLimit(
  limiter: Bottleneck,
  service: string,
  waitMs: number,
  maxRetries = 3,
): Bottleneck {
  limiter.on('failed', (error: Error, info: Bottleneck.EventInfoRetryable) => {
    const isRateLimit =
      error.message?.includes('429') ||
      error.message?.toLowerCase().includes('rate_limit') ||
      error.message?.toLowerCase().includes('rate limit')
    if (isRateLimit && info.retryCount < maxRetries) {
      log.warn(`${service}: rate limited — retrying after ${Math.round(waitMs / 1000)}s`, {
        attempt: info.retryCount + 1,
        maxRetries,
      })
      return waitMs
    }
    // Non-rate-limit errors or exhausted retries: let the error propagate
  })
  return limiter
}

// ─── Anthropic ────────────────────────────────────────────────────────────────
// Tier 1: 8,000 output tokens/minute. Doc-verify calls request up to 8K tokens each,
// so only 1 can safely run at a time within a single invocation.
// On 429: wait 60s for the per-minute OTPM bucket to reset, up to 3 retries.
export const anthropicLimiter = retryOnRateLimit(
  new Bottleneck({ maxConcurrent: 1 }),
  'anthropic',
  60_000,
)

// ─── HubSpot ──────────────────────────────────────────────────────────────────
// Starter plan: 100 req/10s = 10 req/s. Cap at 30% = 3 req/s → minTime 334ms.
// maxConcurrent: 5 allows batched association lookups to parallelize within the cap.
export const hubspotLimiter = retryOnRateLimit(
  new Bottleneck({ maxConcurrent: 5, minTime: 334 }),
  'hubspot',
  2_000,
)

// ─── JustCall ─────────────────────────────────────────────────────────────────
// Burst cap: 60 req/min. 30% cap = 18 req/min. Reservoir refills every 60s.
export const justcallLimiter = retryOnRateLimit(
  new Bottleneck({
    maxConcurrent: 1,
    reservoir: 18,
    reservoirRefreshAmount: 18,
    reservoirRefreshInterval: 60_000,
  }),
  'justcall',
  10_000,
)

// ─── Google ───────────────────────────────────────────────────────────────────
// Drive/Gmail API: very high quota (12K req/min for Drive). Conservative 3 req/s cap.
// On 429 or 503: back off 10s and retry.
export const googleLimiter = retryOnRateLimit(
  new Bottleneck({ maxConcurrent: 3, minTime: 334 }),
  'google',
  10_000,
)

// ─── OpenAI (Whisper transcription) ──────────────────────────────────────────
// Whisper limit: 500 req/min. Cap at 30% = 150 req/min → minTime 400ms.
export const openaiLimiter = retryOnRateLimit(
  new Bottleneck({ maxConcurrent: 3, minTime: 400 }),
  'openai',
  10_000,
)

// ─── Browser (Playwright screenshot) ─────────────────────────────────────────
// Chromium is memory-heavy. Serialize all screenshot calls: one at a time, minimum
// 5s between launches so the process can clean up before the next navigation.
// On 429 from AI vision calls: handled by anthropicLimiter, not this limiter.
export const browserLimiter = retryOnRateLimit(
  new Bottleneck({ maxConcurrent: 1, minTime: 5_000 }),
  'browser',
  10_000,
)

// ─── Skip-tracing (placeholder) ──────────────────────────────────────────────
// Provider not yet chosen — conservative 5 req/s placeholder.
// Update minTime and reservoir when provider and plan are confirmed.
export const skipTracingLimiter = retryOnRateLimit(
  new Bottleneck({ maxConcurrent: 2, minTime: 200 }),
  'skip-tracing',
  5_000,
)
