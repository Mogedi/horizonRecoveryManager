import { describe, it, expect, vi, afterEach } from 'vitest'
import { TokenBucket } from './rate-limiter'

afterEach(() => vi.useRealTimers())

describe('TokenBucket', () => {
  it('starts with full capacity', () => {
    const b = new TokenBucket(3, 3)
    expect(b.available).toBe(3)
  })

  it('deducts a token on acquire', async () => {
    const b = new TokenBucket(3, 3)
    await b.acquire()
    expect(b.available).toBeLessThan(3)
  })

  it('does not exceed capacity on refill', async () => {
    vi.useFakeTimers()
    const b = new TokenBucket(3, 3)
    vi.advanceTimersByTime(10_000)
    expect(b.available).toBe(3)
  })

  it('blocks when empty and resolves after refill', async () => {
    vi.useFakeTimers()
    // 1 token, refills at 10/s (100ms per token), no jitter
    const b = new TokenBucket(1, 10, () => 0)
    await b.acquire() // drains the one token

    let resolved = false
    const p = b.acquire().then(() => { resolved = true })

    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(250) // past the 100ms refill
    await p
    expect(resolved).toBe(true)
  })

  it('allows sequential acquires up to capacity without waiting', async () => {
    const b = new TokenBucket(3, 1)
    const start = Date.now()
    await b.acquire()
    await b.acquire()
    await b.acquire()
    // All three should complete immediately (tokens were available)
    expect(Date.now() - start).toBeLessThan(100)
  })
})
