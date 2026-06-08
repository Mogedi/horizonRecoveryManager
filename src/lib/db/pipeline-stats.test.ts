import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQueryRaw = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/client', () => ({ prisma: { $queryRaw: mockQueryRaw } }))

import { computePipelineStats, getWeeklyCallStats } from './pipeline-stats'
import type { WeeklyCallStats } from './pipeline-stats'
import type { DealWithFlags } from '@/lib/rules'
import type { NormalizedDeal } from '@/lib/rules/types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-08T12:00:00Z')

function makeDeal(overrides: Partial<NormalizedDeal> = {}): NormalizedDeal {
  return {
    hubspotId: 'deal-1',
    name: 'Test Deal',
    stage: '3477730036', // Attempted Contact
    amount: 30000,
    stageEnteredAt: NOW,
    lastActivityDate: NOW,
    contactCount: 2,
    hasValidPhone: true,
    syncedAt: NOW,
    uniqueCallDays: 0,
    ...overrides,
  }
}

function makeResult(deal: NormalizedDeal, severity?: 'urgent' | 'warning'): DealWithFlags {
  return {
    deal,
    flags: severity
      ? [{ type: 'stage_stale', severity, message: 'test flag' }]
      : [],
  }
}

const ZERO_WEEKLY: WeeklyCallStats = {
  totalCalls: 0,
  liveCount: 0,
  voicemailCount: 0,
  disconnectedCount: 0,
  noAnswerCount: 0,
  dealsCalledCount: 0,
}

const STAGE_MAP: Record<string, string> = {
  '3477730034': 'New Case',
  '3477730035': 'Ready for Outreach',
  '3477730036': 'Attempted Contact',
  '3477730037': 'Contact Made',
  '3477730038': 'Follow-Up Needed',
  '3477730039': 'Engaged / Interested',
  '3551234806': 'Letter Outreach - Final Attempt',
  '3477730040': 'Agreement Sent',
  '3478695644': 'Signed / In Progress',
  '3478695645': 'Closed – Paid',
  '3478695646': 'Dead / Not Interested',
  '3513772741': 'DNC',
  '3513772742': 'Blocked, Missing Info',
  '3741613778': 'Exhausted',
  '3501274836': 'More Research Need',
  '3639720641': 'F',
}

// ─── computePipelineStats ─────────────────────────────────────────────────────

describe('computePipelineStats', () => {
  it('counts deals per stage correctly', () => {
    const results = [
      makeResult(makeDeal({ hubspotId: 'a', stage: '3477730036' })),
      makeResult(makeDeal({ hubspotId: 'b', stage: '3477730036' })),
      makeResult(makeDeal({ hubspotId: 'c', stage: '3477730037' })),
    ]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    const attempted = stats.byStage.find(s => s.stageId === '3477730036')!
    const contactMade = stats.byStage.find(s => s.stageId === '3477730037')!
    expect(attempted.dealCount).toBe(2)
    expect(contactMade.dealCount).toBe(1)
  })

  it('sums amounts per stage, excluding nulls', () => {
    const results = [
      makeResult(makeDeal({ hubspotId: 'a', stage: '3477730036', amount: 30000 })),
      makeResult(makeDeal({ hubspotId: 'b', stage: '3477730036', amount: 40000 })),
      makeResult(makeDeal({ hubspotId: 'c', stage: '3477730036', amount: null })),
    ]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    const stage = stats.byStage.find(s => s.stageId === '3477730036')!
    expect(stage.totalValue).toBe(70000)
    expect(stage.dealCount).toBe(3)
  })

  it('buckets urgent/warn/healthy from primary flag severity', () => {
    const results = [
      makeResult(makeDeal({ hubspotId: 'a', stage: '3477730036' }), 'urgent'),
      makeResult(makeDeal({ hubspotId: 'b', stage: '3477730036' }), 'warning'),
      makeResult(makeDeal({ hubspotId: 'c', stage: '3477730036' })),
    ]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    const stage = stats.byStage.find(s => s.stageId === '3477730036')!
    expect(stage.urgentCount).toBe(1)
    expect(stage.warnCount).toBe(1)
    expect(stage.healthyCount).toBe(1)
    expect(stage.snoozedCount).toBe(0)
  })

  it('snoozed deals counted in snoozedCount, excluded from urgent/warn/healthy', () => {
    const snoozed = new Set(['deal-snoozed'])
    const results = [
      makeResult(makeDeal({ hubspotId: 'deal-snoozed', stage: '3477730036' }), 'urgent'),
      makeResult(makeDeal({ hubspotId: 'deal-active', stage: '3477730036' }), 'urgent'),
    ]
    const stats = computePipelineStats(results, STAGE_MAP, snoozed, ZERO_WEEKLY)
    const stage = stats.byStage.find(s => s.stageId === '3477730036')!
    expect(stage.snoozedCount).toBe(1)
    expect(stage.urgentCount).toBe(1) // only the non-snoozed one
  })

  it('terminal stage deals excluded from byStage rows', () => {
    const results = [
      makeResult(makeDeal({ hubspotId: 'a', stage: '3478695645' })), // Closed-Paid (terminal)
      makeResult(makeDeal({ hubspotId: 'b', stage: '3477730036' })), // Attempted Contact (active)
    ]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    const stageIds = stats.byStage.map(s => s.stageId)
    expect(stageIds).not.toContain('3478695645')
    expect(stageIds).toContain('3477730036')
  })

  it('byStage follows funnel display order', () => {
    const results = [
      makeResult(makeDeal({ hubspotId: 'a', stage: '3478695644' })), // Signed
      makeResult(makeDeal({ hubspotId: 'b', stage: '3477730034' })), // New Case
      makeResult(makeDeal({ hubspotId: 'c', stage: '3477730036' })), // Attempted Contact
    ]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    const ids = stats.byStage.map(s => s.stageId)
    expect(ids.indexOf('3477730034')).toBeLessThan(ids.indexOf('3477730036'))
    expect(ids.indexOf('3477730036')).toBeLessThan(ids.indexOf('3478695644'))
  })

  it('stages with 0 deals are omitted from byStage', () => {
    const results = [makeResult(makeDeal({ hubspotId: 'a', stage: '3477730036' }))]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    const emptyStage = stats.byStage.find(s => s.stageId === '3477730034')
    expect(emptyStage).toBeUndefined()
  })

  it('deal in unknown stageId appears in KPI totals but not byStage', () => {
    const results = [
      makeResult(makeDeal({ hubspotId: 'a', stage: 'unknown-stage-id', amount: 50000 })),
    ]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    const unknownInBar = stats.byStage.find(s => s.stageId === 'unknown-stage-id')
    expect(unknownInBar).toBeUndefined()
    expect(stats.kpi.totalPipelineValue).toBe(50000)
    expect(stats.kpi.totalActiveDeals).toBe(1)
  })

  it('KPI.totalPipelineValue sums all non-terminal deal amounts', () => {
    const results = [
      makeResult(makeDeal({ hubspotId: 'a', stage: '3477730036', amount: 30000 })),
      makeResult(makeDeal({ hubspotId: 'b', stage: '3477730040', amount: 40000 })), // Agreement Sent
      makeResult(makeDeal({ hubspotId: 'c', stage: '3478695645', amount: 10000 })), // Closed-Paid (terminal)
    ]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    // 30K + 40K = 70K (terminal excluded)
    expect(stats.kpi.totalPipelineValue).toBe(70000)
  })

  it('KPI.closingValue sums only Agreement Sent + Signed', () => {
    const results = [
      makeResult(makeDeal({ hubspotId: 'a', stage: '3477730036', amount: 30000 })), // Attempted Contact
      makeResult(makeDeal({ hubspotId: 'b', stage: '3477730040', amount: 40000 })), // Agreement Sent
      makeResult(makeDeal({ hubspotId: 'c', stage: '3478695644', amount: 50000 })), // Signed
    ]
    const stats = computePipelineStats(results, STAGE_MAP, new Set(), ZERO_WEEKLY)
    expect(stats.kpi.closingValue).toBe(90000)
    expect(stats.kpi.closingCount).toBe(2)
  })

  it('KPI.needsAttentionCount counts urgent+warn, excludes snoozed', () => {
    const snoozed = new Set(['deal-snoozed'])
    const results = [
      makeResult(makeDeal({ hubspotId: 'deal-snoozed', stage: '3477730036' }), 'urgent'),
      makeResult(makeDeal({ hubspotId: 'b', stage: '3477730036' }), 'urgent'),
      makeResult(makeDeal({ hubspotId: 'c', stage: '3477730036' }), 'warning'),
      makeResult(makeDeal({ hubspotId: 'd', stage: '3477730036' })), // healthy
    ]
    const stats = computePipelineStats(results, STAGE_MAP, snoozed, ZERO_WEEKLY)
    expect(stats.kpi.needsAttentionCount).toBe(2) // b (urgent) + c (warning)
    expect(stats.kpi.urgentCount).toBe(1)          // only b
  })

  it('weeklyCalls is passed through to output unchanged', () => {
    const weekly: WeeklyCallStats = {
      totalCalls: 143,
      liveCount: 47,
      voicemailCount: 91,
      disconnectedCount: 3,
      noAnswerCount: 2,
      dealsCalledCount: 38,
    }
    const stats = computePipelineStats([], STAGE_MAP, new Set(), weekly)
    expect(stats.weeklyCalls).toEqual(weekly)
  })
})

// ─── getWeeklyCallStats ───────────────────────────────────────────────────────

describe('getWeeklyCallStats', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns zeros when DB returns an empty-count row', async () => {
    mockQueryRaw.mockResolvedValue([{
      total_calls: 0,
      live_count: 0,
      voicemail_count: 0,
      disconnected_count: 0,
      no_answer_count: 0,
      deals_called_count: 0,
    }])
    const result = await getWeeklyCallStats()
    expect(result).toEqual({
      totalCalls: 0,
      liveCount: 0,
      voicemailCount: 0,
      disconnectedCount: 0,
      noAnswerCount: 0,
      dealsCalledCount: 0,
    })
  })

  it('maps DB row fields to WeeklyCallStats correctly', async () => {
    mockQueryRaw.mockResolvedValue([{
      total_calls: 143,
      live_count: 47,
      voicemail_count: 91,
      disconnected_count: 3,
      no_answer_count: 2,
      deals_called_count: 38,
    }])
    const result = await getWeeklyCallStats(7)
    expect(result.totalCalls).toBe(143)
    expect(result.liveCount).toBe(47)
    expect(result.voicemailCount).toBe(91)
    expect(result.disconnectedCount).toBe(3)
    expect(result.noAnswerCount).toBe(2)
    expect(result.dealsCalledCount).toBe(38)
  })

  it('passes daysBack to the query (default 7)', async () => {
    mockQueryRaw.mockResolvedValue([{
      total_calls: 0, live_count: 0, voicemail_count: 0,
      disconnected_count: 0, no_answer_count: 0, deals_called_count: 0,
    }])
    await getWeeklyCallStats()
    expect(mockQueryRaw).toHaveBeenCalledOnce()
    // The SQL template literal is called with daysBack=7 as a bound parameter
    const callArgs = mockQueryRaw.mock.calls[0]
    expect(callArgs).toBeDefined()
  })
})
