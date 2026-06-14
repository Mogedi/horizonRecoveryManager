import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-session', () => ({
  isAuthedOrAgent: vi.fn().mockResolvedValue(true),
  unauthorizedResponse: vi.fn(() => new Response('unauth', { status: 401 })),
}))
vi.mock('@/lib/db/deals', () => ({ setDealCaseType: vi.fn(async (id: string, caseType: string) => ({ hubspotId: id, caseType })) }))
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { PATCH } from './route'
import { setDealCaseType } from '@/lib/db/deals'

const mSet = vi.mocked(setDealCaseType)
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/deals/${id}/case-type`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    { params: Promise.resolve({ id }) },
  )

describe('PATCH /api/deals/[id]/case-type', () => {
  beforeEach(() => mSet.mockClear())

  it('sets a valid case type', async () => {
    const res = await patch('deal-1', { caseType: 'estate_sale' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hubspotId: 'deal-1', caseType: 'estate_sale' })
    expect(mSet).toHaveBeenCalledWith('deal-1', 'estate_sale')
  })

  it('rejects an invalid case type (enum drift guard) without touching the DB', async () => {
    const res = await patch('deal-1', { caseType: 'foreclosure_typo' })
    expect(res.status).toBe(400)
    expect(mSet).not.toHaveBeenCalled()
  })

  it('rejects a missing case type', async () => {
    const res = await patch('deal-1', {})
    expect(res.status).toBe(400)
    expect(mSet).not.toHaveBeenCalled()
  })
})
