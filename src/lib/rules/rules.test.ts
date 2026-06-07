import { describe, it, expect } from 'vitest'
import { checkStaleness } from './staleness'
import { checkAgreement } from './agreement'
import { checkSigned } from './signed'
import { checkContacts } from './contacts'
import { checkSnooze } from './snooze'
import type { NormalizedDeal, RuleContext } from './types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ATTEMPTED_CONTACT_STAGE = '3477730036' // threshold: 7 business days
const AGREEMENT_SENT_STAGE    = '3477730040'
const SIGNED_STAGE            = '3478695644'
const TERMINAL_STAGE          = '3478695645' // Closed – Paid
const READY_STAGE             = '3477730035' // threshold: 5 business days

// Monday May 4, 2026 at noon UTC — our "entered stage" anchor
const MONDAY = new Date('2026-05-04T12:00:00Z')
// Wednesday May 13 = 7 business days after Monday May 4
const SEVEN_BIZ_DAYS_LATER = new Date('2026-05-13T12:00:00Z')
// Friday May 8 = 4 business days after Monday May 4
const FOUR_BIZ_DAYS_LATER = new Date('2026-05-08T12:00:00Z')
// Tuesday May 6 = 2 business days after Monday May 4
const TWO_BIZ_DAYS_LATER = new Date('2026-05-06T12:00:00Z')
// Tuesday May 12 = 6 business days after Mon May 4
const SIX_BIZ_DAYS_LATER = new Date('2026-05-12T12:00:00Z')

function makeDeal(overrides: Partial<NormalizedDeal> = {}): NormalizedDeal {
  return {
    hubspotId: 'deal-123',
    name: 'TEST DEAL',
    stage: ATTEMPTED_CONTACT_STAGE,
    amount: 35000,
    stageEnteredAt: MONDAY,
    lastActivityDate: MONDAY,
    contactCount: 3,
    syncedAt: MONDAY,
    ...overrides,
  }
}

function makeCtx(todayOverride: Date, snoozedIds: string[] = []): RuleContext {
  return {
    today: todayOverride,
    timezone: 'America/New_York',
    stageMap: {
      [ATTEMPTED_CONTACT_STAGE]: 'Attempted Contact',
      [AGREEMENT_SENT_STAGE]: 'Agreement Sent',
      [SIGNED_STAGE]: 'Signed / In Progress',
      [TERMINAL_STAGE]: 'Closed – Paid',
      [READY_STAGE]: 'Ready for Outreach',
    },
    staleThresholds: {
      [ATTEMPTED_CONTACT_STAGE]: 7,
      [READY_STAGE]: 5,
    },
    terminalStageIds: new Set([TERMINAL_STAGE]),
    snoozedDealIds: new Set(snoozedIds),
  }
}

// ─── checkStaleness ───────────────────────────────────────────────────────────

describe('checkStaleness', () => {
  it('returns null when elapsed < threshold', () => {
    // 6 business days elapsed, threshold 7
    const flag = checkStaleness(makeDeal(), makeCtx(SIX_BIZ_DAYS_LATER))
    expect(flag).toBeNull()
  })

  it('fires when elapsed >= threshold', () => {
    // 7 business days elapsed, threshold 7
    const flag = checkStaleness(makeDeal(), makeCtx(SEVEN_BIZ_DAYS_LATER))
    expect(flag).not.toBeNull()
    expect(flag?.type).toBe('stage_stale')
  })

  it('never fires on terminal stages', () => {
    const deal = makeDeal({ stage: TERMINAL_STAGE })
    const flag = checkStaleness(deal, makeCtx(SEVEN_BIZ_DAYS_LATER))
    expect(flag).toBeNull()
  })

  it('returns null when stage has no threshold entry', () => {
    const deal = makeDeal({ stage: AGREEMENT_SENT_STAGE }) // not in staleThresholds
    const flag = checkStaleness(deal, makeCtx(SEVEN_BIZ_DAYS_LATER))
    expect(flag).toBeNull()
  })

  it('returns null when stageEnteredAt is null', () => {
    const deal = makeDeal({ stageEnteredAt: null })
    const flag = checkStaleness(deal, makeCtx(SEVEN_BIZ_DAYS_LATER))
    expect(flag).toBeNull()
  })

  it('includes daysOverdue in flag', () => {
    // 7 elapsed, threshold 7 → 0 overdue (right at threshold)
    const flag = checkStaleness(makeDeal(), makeCtx(SEVEN_BIZ_DAYS_LATER))
    expect(flag?.daysOverdue).toBe(0)
  })

  it('severity is urgent when 3+ days overdue', () => {
    // 10 business days elapsed, threshold 7 → 3 overdue
    const tenBizDays = new Date('2026-05-18T12:00:00Z') // Mon May 18 = 10 biz days from Mon May 4
    const flag = checkStaleness(makeDeal(), makeCtx(tenBizDays))
    expect(flag?.severity).toBe('urgent')
  })

  it('severity is warning when < 3 days overdue', () => {
    const flag = checkStaleness(makeDeal(), makeCtx(SEVEN_BIZ_DAYS_LATER))
    expect(flag?.severity).toBe('warning')
  })
})

// ─── checkAgreement ───────────────────────────────────────────────────────────

describe('checkAgreement', () => {
  it('returns null for non-Agreement-Sent stage', () => {
    const flag = checkAgreement(makeDeal(), makeCtx(TWO_BIZ_DAYS_LATER))
    expect(flag).toBeNull()
  })

  it('returns null when lastActivityDate is recent (< 2 biz days)', () => {
    const deal = makeDeal({ stage: AGREEMENT_SENT_STAGE, lastActivityDate: MONDAY })
    // Only 1 business day elapsed (Mon → Tue)
    const flag = checkAgreement(deal, makeCtx(new Date('2026-05-05T12:00:00Z')))
    expect(flag).toBeNull()
  })

  it('fires when lastActivityDate >= 2 biz days ago', () => {
    const deal = makeDeal({ stage: AGREEMENT_SENT_STAGE, lastActivityDate: MONDAY })
    const flag = checkAgreement(deal, makeCtx(TWO_BIZ_DAYS_LATER))
    expect(flag).not.toBeNull()
    expect(flag?.type).toBe('agreement_no_followup')
    expect(flag?.severity).toBe('urgent')
  })

  it('returns null when lastActivityDate is null', () => {
    const deal = makeDeal({ stage: AGREEMENT_SENT_STAGE, lastActivityDate: null })
    const flag = checkAgreement(deal, makeCtx(TWO_BIZ_DAYS_LATER))
    expect(flag).toBeNull()
  })
})

// ─── checkSigned ─────────────────────────────────────────────────────────────

describe('checkSigned', () => {
  it('returns null for non-Signed stage', () => {
    const flag = checkSigned(makeDeal(), makeCtx(SEVEN_BIZ_DAYS_LATER))
    expect(flag).toBeNull()
  })

  it('returns null when activity is recent (< 5 biz days)', () => {
    const deal = makeDeal({ stage: SIGNED_STAGE, lastActivityDate: MONDAY })
    // 4 business days elapsed
    const flag = checkSigned(deal, makeCtx(FOUR_BIZ_DAYS_LATER))
    expect(flag).toBeNull()
  })

  it('fires when no activity for >= 5 biz days', () => {
    const deal = makeDeal({ stage: SIGNED_STAGE, lastActivityDate: MONDAY })
    // Monday May 4 → next Monday May 11 = 5 business days
    const fiveDays = new Date('2026-05-11T12:00:00Z')
    const flag = checkSigned(deal, makeCtx(fiveDays))
    expect(flag).not.toBeNull()
    expect(flag?.type).toBe('signed_no_activity')
  })
})

// ─── checkContacts ────────────────────────────────────────────────────────────

describe('checkContacts', () => {
  it('returns null when contactCount > 0', () => {
    const flag = checkContacts(makeDeal({ contactCount: 2 }), makeCtx(MONDAY))
    expect(flag).toBeNull()
  })

  it('fires when contactCount = 0', () => {
    const flag = checkContacts(makeDeal({ contactCount: 0 }), makeCtx(MONDAY))
    expect(flag).not.toBeNull()
    expect(flag?.type).toBe('no_contacts')
  })

  it('fires regardless of stage', () => {
    const flag = checkContacts(makeDeal({ contactCount: 0, stage: TERMINAL_STAGE }), makeCtx(MONDAY))
    expect(flag).not.toBeNull()
  })
})

// ─── checkSnooze ─────────────────────────────────────────────────────────────

describe('checkSnooze', () => {
  it('returns null when deal is not snoozed', () => {
    const flag = checkSnooze(makeDeal(), makeCtx(MONDAY))
    expect(flag).toBeNull()
  })

  it('returns snoozed flag when deal is in snoozed set', () => {
    const ctx = makeCtx(MONDAY, ['deal-123'])
    const flag = checkSnooze(makeDeal(), ctx)
    expect(flag).not.toBeNull()
    expect(flag?.type).toBe('snoozed')
  })

  it('does not fire for a different deal ID', () => {
    const ctx = makeCtx(MONDAY, ['deal-456'])
    const flag = checkSnooze(makeDeal({ hubspotId: 'deal-123' }), ctx)
    expect(flag).toBeNull()
  })
})
