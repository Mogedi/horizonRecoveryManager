// All types shared across the rules engine.
// Rules import from here only — never from Prisma or db/ directly.

export type NormalizedDeal = {
  hubspotId: string
  name: string | null
  stage: string | null      // stage ID — resolve to name via ctx.stageMap
  amount: number | null     // already converted from Prisma Decimal in db/deals.ts
  stageEnteredAt: Date | null
  lastActivityDate: Date | null
  contactCount: number
  // null = Layer 2 not yet synced for this deal (fall back to contactCount check)
  // false = Layer 2 synced, no contact has a valid phone number
  // true  = Layer 2 synced, at least one contact has a valid phone number
  hasValidPhone: boolean | null
  syncedAt: Date
  // Distinct calendar days (America/New_York) with at least one outbound JustCall attempt.
  // 0 = never called. Used by checkCallsExhausted (fires at 7+ unique days).
  uniqueCallDays: number
}

export type RuleContext = {
  today: Date                              // injected — freeze in tests
  timezone: 'America/New_York'
  stageMap: Record<string, string>         // stage ID → stage name
  staleThresholds: Record<string, number>  // stage ID → business days (thresholds.ts → app_settings M7)
  agreementNoFollowupDays: number          // business days before Agreement Sent fires (default: 2)
  signedNoActivityDays: number             // business days before Signed/In Progress fires (default: 5)
  terminalStageIds: Set<string>
  snoozedDealIds: Set<string>             // preloaded once per request
}

export type AttentionFlagType =
  | 'stage_stale'
  | 'agreement_no_followup'
  | 'signed_no_activity'
  | 'no_contacts'
  | 'calls_exhausted'
  | 'snoozed'

export type AttentionFlag = {
  type: AttentionFlagType
  severity: 'urgent' | 'warning' | 'info'
  message: string
  daysOverdue?: number
}

export type Rule = (deal: NormalizedDeal, ctx: RuleContext) => AttentionFlag | null
