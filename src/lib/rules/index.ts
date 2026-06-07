import { checkSnooze } from './snooze'
import { checkStaleness } from './staleness'
import { checkAgreement } from './agreement'
import { checkSigned } from './signed'
import { checkContacts } from './contacts'
import type { NormalizedDeal, RuleContext, AttentionFlag } from './types'

export type { NormalizedDeal, RuleContext, AttentionFlag }
export type { AttentionFlagType } from './types'
export { buildRuleCtx } from './ctx'

export type DealWithFlags = {
  deal: NormalizedDeal
  flags: AttentionFlag[]
}

// Snooze runs first — if snoozed, skip all other rules.
// Remaining rules run in priority order; a deal can have multiple flags.
const RULES = [checkStaleness, checkAgreement, checkSigned, checkContacts]

export function applyRules(deal: NormalizedDeal, ctx: RuleContext): AttentionFlag[] {
  const snoozeFlag = checkSnooze(deal, ctx)
  if (snoozeFlag) return [snoozeFlag]

  return RULES.flatMap(rule => {
    const flag = rule(deal, ctx)
    return flag ? [flag] : []
  })
}

export function evaluateAll(deals: NormalizedDeal[], ctx: RuleContext): DealWithFlags[] {
  return deals.map(deal => ({ deal, flags: applyRules(deal, ctx) }))
}
