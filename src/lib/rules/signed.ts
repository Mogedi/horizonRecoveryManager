import { businessDaysElapsed } from '@/lib/utils/business-days'
import type { Rule, AttentionFlag } from './types'

export const checkSigned: Rule = (deal, ctx) => {
  const stageName = deal.stage ? ctx.stageMap[deal.stage] : null
  if (stageName !== 'Signed / In Progress') return null

  if (!deal.lastActivityDate) return null

  const elapsed = businessDaysElapsed(deal.lastActivityDate, ctx.today)
  if (elapsed < ctx.signedNoActivityDays) return null

  return {
    type: 'signed_no_activity',
    severity: 'warning',
    daysOverdue: elapsed - ctx.signedNoActivityDays,
    message: `No activity for ${elapsed} business days`,
  } satisfies AttentionFlag
}
