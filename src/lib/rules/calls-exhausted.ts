import { TERMINAL_STAGE_IDS } from '@/lib/db/settings'
import type { Rule } from './types'

// Fires when a deal has been called on 7+ distinct calendar days (America/New_York)
// with no answer or progress. Signals it's time to reassess or close the deal.
// Warning at 7–9 days; urgent at 10+ days.
export const checkCallsExhausted: Rule = (deal) => {
  if (TERMINAL_STAGE_IDS.has(deal.stage ?? '')) return null
  if (deal.uniqueCallDays < 7) return null

  const severity = deal.uniqueCallDays >= 10 ? 'urgent' : 'warning'
  return {
    type: 'calls_exhausted',
    severity,
    message: `Called on ${deal.uniqueCallDays} separate days with no progress — consider closing or skip-tracing`,
  }
}
