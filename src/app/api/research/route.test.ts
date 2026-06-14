import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-session', () => ({
  isAuthedOrAgent: vi.fn().mockResolvedValue(true),
  isAuthenticated: vi.fn().mockResolvedValue(true),
  unauthorizedResponse: vi.fn(),
}))
vi.mock('@/lib/db/research', () => ({
  enqueueRequest: vi.fn().mockResolvedValue({ id: 99, status: 'pending' }),
  findRecentDossierForCase: vi.fn().mockResolvedValue(null),
  findRecentPropertyEvidenceForCase: vi.fn().mockResolvedValue(null),
  // GET-only deps (unused here, present so the module imports cleanly)
  listRecentDossiersWithCost: vi.fn(), listRequests: vi.fn(), getProgressForRequests: vi.fn(), getCostTrend: vi.fn(),
}))
vi.mock('@/lib/db/deals', () => ({ getDealCaseType: vi.fn().mockResolvedValue(null) }))

import { POST } from './route'
import { enqueueRequest, findRecentDossierForCase, findRecentPropertyEvidenceForCase } from '@/lib/db/research'
import { getDealCaseType } from '@/lib/db/deals'

const mEnqueue = vi.mocked(enqueueRequest)
const mDossier = vi.mocked(findRecentDossierForCase)
const mProperty = vi.mocked(findRecentPropertyEvidenceForCase)
const mCaseType = vi.mocked(getDealCaseType)

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://localhost/api/research', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }))

describe('POST /api/research — goal-aware idempotency', () => {
  beforeEach(() => { mEnqueue.mockClear(); mDossier.mockClear().mockResolvedValue(null); mProperty.mockClear().mockResolvedValue(null); mCaseType.mockClear().mockResolvedValue(null) })

  it('property_records is REFUSED for a case type that does not want property (estate sale)', async () => {
    mCaseType.mockResolvedValue('estate_sale')
    const res = await post({ name: 'Jane Doe', goal: 'property_records', caseId: 'deal-1' })
    expect(await res.json()).toMatchObject({ skipped: true, reason: 'case_type_no_property', caseType: 'estate_sale' })
    expect(mEnqueue).not.toHaveBeenCalled()
    expect(mProperty).not.toHaveBeenCalled()
  })

  it('the run-level caseType (from the form) gates property even with no linked deal', async () => {
    const res = await post({ name: 'Jane Doe', goal: 'property_records', caseType: 'state_funds', address: '1 Main St' })
    expect(await res.json()).toMatchObject({ skipped: true, reason: 'case_type_no_property', caseType: 'state_funds' })
    expect(mCaseType).not.toHaveBeenCalled() // used the run's own type, no deal lookup
  })

  it('property_records with no address or parcel → 400 asking for one', async () => {
    const res = await post({ name: 'Jane Doe', goal: 'property_records' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ needs: 'address' })
  })

  it('parses city/state out of the full address into the stored query', async () => {
    await post({ name: 'Jane Doe', goal: 'find_heirs', address: '301 Lowell St, Atlanta, GA 30310' })
    expect(mEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ city: 'Atlanta', state: 'GA', zip: '30310' }),
    }))
  })

  it('property_records uses the property key, NOT the person-dossier key', async () => {
    mDossier.mockResolvedValue({ id: 1, createdAt: new Date(), reviewStatus: 'pending' }) // a person dossier exists…
    const res = await post({ name: 'Jane Doe', goal: 'property_records', caseId: 'deal-1', address: '1 Main St, Atlanta, GA' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ requestId: 99 }) // …but the property run still enqueues
    expect(mProperty).toHaveBeenCalledWith('deal-1')
    expect(mDossier).not.toHaveBeenCalled()
  })

  it('property_records skips when recent property evidence exists', async () => {
    mProperty.mockResolvedValue({ id: 42, completedAt: new Date() })
    const res = await post({ name: 'Jane Doe', goal: 'property_records', caseId: 'deal-1', address: '1 Main St, Atlanta, GA' })
    expect(await res.json()).toMatchObject({ skipped: true, reason: 'recent_property_evidence', evidencePackageId: 42 })
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('a person goal still uses the person-dossier key', async () => {
    mDossier.mockResolvedValue({ id: 7, createdAt: new Date(), reviewStatus: 'pending' })
    const res = await post({ name: 'Jane Doe', goal: 'find_heirs', caseId: 'deal-1' })
    expect(await res.json()).toMatchObject({ skipped: true, reason: 'recent_dossier', dossierId: 7 })
    expect(mProperty).not.toHaveBeenCalled()
  })

  it('force bypasses idempotency and enqueues the property goal', async () => {
    mProperty.mockResolvedValue({ id: 42, completedAt: new Date() })
    const res = await post({ name: 'Jane Doe', goal: 'property_records', caseId: 'deal-1', address: '1 Main St, Atlanta, GA', force: true })
    expect(await res.json()).toMatchObject({ requestId: 99 })
    expect(mProperty).not.toHaveBeenCalled()
    expect(mEnqueue).toHaveBeenCalledWith(expect.objectContaining({ goal: 'property_records' }))
  })
})
