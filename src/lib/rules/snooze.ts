import type { Rule, AttentionFlag } from './types'

// Snooze check runs before all other rules.
// If snoozed, suppress all other flags — deal is intentionally parked.
// Snooze expiry is handled in db/deals.ts (only active snoozes are in ctx.snoozedDealIds).
export const checkSnooze: Rule = (deal, ctx) => {
  if (!ctx.snoozedDealIds.has(deal.hubspotId)) return null

  return {
    type: 'snoozed',
    severity: 'info',
    message: 'Snoozed',
  } satisfies AttentionFlag
}
