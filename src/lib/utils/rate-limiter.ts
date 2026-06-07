const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export class TokenBucket {
  private tokens: number
  private lastRefillMs: number

  constructor(
    readonly capacity: number = 3,
    readonly refillPerSecond: number = 3,
    // Jitter prevents synchronized bursts; injectable for testing
    private readonly jitterMs: () => number = () => Math.random() * 100 - 50
  ) {
    this.tokens = capacity
    this.lastRefillMs = Date.now()
  }

  get available(): number {
    this.refill()
    return this.tokens
  }

  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }
    const waitMs = 1000 / this.refillPerSecond + this.jitterMs()
    await sleep(Math.max(0, waitMs))
    return this.acquire()
  }

  private refill() {
    const now = Date.now()
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.lastRefillMs) * this.refillPerSecond) / 1000
    )
    this.lastRefillMs = now
  }
}

// One per process — serverless invocations start fresh each time
export const rateLimiter = new TokenBucket()
