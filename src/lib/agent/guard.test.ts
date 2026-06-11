import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the DB layer so the kill-switch read doesn't instantiate Prisma.
vi.mock('@/lib/db/settings', () => ({ areAgentWritesEnabled: vi.fn() }))

import { areAgentWritesEnabled } from '@/lib/db/settings'
import {
  extractRequestMeta,
  getCorrelationId,
  getIdempotencyKey,
  assertAgentWritesEnabled,
  agentWritesDisabledResponse,
} from './guard'

const mockEnabled = vi.mocked(areAgentWritesEnabled)

function req(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/tasks', { method: 'POST', headers })
}

beforeEach(() => vi.clearAllMocks())

describe('extractRequestMeta', () => {
  it('parses ip (first x-forwarded-for), userAgent, requestId', () => {
    const meta = extractRequestMeta(
      req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'user-agent': 'hermes/1', 'x-vercel-id': 'abc' })
    )
    expect(meta.ip).toBe('1.2.3.4')
    expect(meta.userAgent).toBe('hermes/1')
    expect(meta.requestId).toBe('abc')
  })

  it('returns nulls when headers are absent', () => {
    const meta = extractRequestMeta(req({}))
    expect(meta.ip).toBeNull()
    expect(meta.userAgent).toBeNull()
    expect(meta.requestId).toBeNull()
  })
})

describe('correlation + idempotency headers', () => {
  it('reads x-correlation-id and idempotency-key', () => {
    const r = req({ 'x-correlation-id': 'wf-1', 'idempotency-key': 'k-1' })
    expect(getCorrelationId(r)).toBe('wf-1')
    expect(getIdempotencyKey(r)).toBe('k-1')
  })

  it('returns null when absent', () => {
    const r = req({})
    expect(getCorrelationId(r)).toBeNull()
    expect(getIdempotencyKey(r)).toBeNull()
  })
})

describe('kill switch', () => {
  it('assertAgentWritesEnabled delegates to the settings read', async () => {
    mockEnabled.mockResolvedValue(false)
    expect(await assertAgentWritesEnabled()).toBe(false)
    mockEnabled.mockResolvedValue(true)
    expect(await assertAgentWritesEnabled()).toBe(true)
  })

  it('agentWritesDisabledResponse returns 423', async () => {
    const res = agentWritesDisabledResponse()
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(String(body.error)).toMatch(/disabled/i)
  })
})
