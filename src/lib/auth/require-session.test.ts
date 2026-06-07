import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock 'server-only' so it doesn't throw in the test environment
vi.mock('server-only', () => ({}))

// Mock next/headers — cookies() is a Next.js server runtime API unavailable in Vitest
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

// Mock session module so tests don't need a real SESSION_SECRET
vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'horizon_session',
  verifySessionToken: vi.fn(),
}))

import { cookies } from 'next/headers'
import { verifySessionToken } from '@/lib/auth/session'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from './require-session'

const mockCookies = vi.mocked(cookies)
const mockVerify = vi.mocked(verifySessionToken)

function makeCookieStore(token: string | undefined) {
  return {
    get: (name: string) => (name === 'horizon_session' && token ? { value: token } : undefined),
  }
}

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader) headers['authorization'] = authHeader
  return new NextRequest('http://localhost/api/sync/layer1', {
    method: 'POST',
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
})

// ---------------------------------------------------------------------------
// isAuthenticated
// ---------------------------------------------------------------------------

describe('isAuthenticated', () => {
  it('returns false when no cookie present', async () => {
    mockCookies.mockResolvedValue(makeCookieStore(undefined) as never)
    expect(await isAuthenticated()).toBe(false)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns false when JWT verification fails', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('bad-token') as never)
    mockVerify.mockResolvedValue(false)
    expect(await isAuthenticated()).toBe(false)
  })

  it('returns true when JWT verification passes', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('valid-jwt') as never)
    mockVerify.mockResolvedValue(true)
    expect(await isAuthenticated()).toBe(true)
  })

  it('passes the token from the cookie to verifySessionToken', async () => {
    mockCookies.mockResolvedValue(makeCookieStore('my-token-abc') as never)
    mockVerify.mockResolvedValue(true)
    await isAuthenticated()
    expect(mockVerify).toHaveBeenCalledWith('my-token-abc')
  })
})

// ---------------------------------------------------------------------------
// isCronRequest
// ---------------------------------------------------------------------------

describe('isCronRequest', () => {
  it('returns true when Authorization header matches CRON_SECRET', () => {
    const req = makeRequest('Bearer test-cron-secret')
    expect(isCronRequest(req)).toBe(true)
  })

  it('returns false when Authorization header is wrong', () => {
    const req = makeRequest('Bearer wrong-secret')
    expect(isCronRequest(req)).toBe(false)
  })

  it('returns false when Authorization header is missing', () => {
    const req = makeRequest()
    expect(isCronRequest(req)).toBe(false)
  })

  it('returns false when CRON_SECRET is not set', () => {
    delete process.env.CRON_SECRET
    const req = makeRequest('Bearer test-cron-secret')
    expect(isCronRequest(req)).toBe(false)
  })

  it('is not fooled by a prefix match — "Bearer test-cron-secretEXTRA" fails', () => {
    const req = makeRequest('Bearer test-cron-secretEXTRA')
    expect(isCronRequest(req)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// unauthorizedResponse
// ---------------------------------------------------------------------------

describe('unauthorizedResponse', () => {
  it('returns 401 status', async () => {
    const res = unauthorizedResponse()
    expect(res.status).toBe(401)
  })

  it('returns JSON body with error field', async () => {
    const res = unauthorizedResponse()
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns a new response on each call (not a shared reference)', () => {
    const a = unauthorizedResponse()
    const b = unauthorizedResponse()
    expect(a).not.toBe(b)
  })
})
