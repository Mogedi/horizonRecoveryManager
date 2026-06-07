import { businessDaysElapsed } from '@/lib/utils/business-days'
import type { Rule, AttentionFlag } from './types'

export const checkStaleness: Rule = (deal, ctx) => {
  if (!deal.stage) return null
  if (ctx.terminalStageIds.has(deal.stage)) return null

  const threshold = ctx.staleThresholds[deal.stage]
  if (!threshold) return null

  if (!deal.stageEnteredAt) return null

  const elapsed = businessDaysElapsed(deal.stageEnteredAt, ctx.today)
  if (elapsed < threshold) return null

  const daysOverdue = elapsed - threshold
  const severity = daysOverdue >= 3 ? 'urgent' : 'warning'

  return {
    type: 'stage_stale',
    severity,
    daysOverdue,
    message: `In stage ${elapsed} business days (threshold: ${threshold})`,
  } satisfies AttentionFlag
}
