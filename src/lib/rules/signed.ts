import { businessDaysElapsed } from '@/lib/utils/business-days'
import { SIGNED_IN_PROGRESS_NO_ACTIVITY_DAYS } from '@/lib/utils/thresholds'
import type { Rule, AttentionFlag } from './types'

export const checkSigned: Rule = (deal, ctx) => {
  const stageName = deal.stage ? ctx.stageMap[deal.stage] : null
  if (stageName !== 'Signed / In Progress') return null

  if (!deal.lastActivityDate) return null

  const elapsed = businessDaysElapsed(deal.lastActivityDate, ctx.today)
  if (elapsed < SIGNED_IN_PROGRESS_NO_ACTIVITY_DAYS) return null

  return {
    type: 'signed_no_activity',
    severity: 'warning',
    daysOverdue: elapsed - SIGNED_IN_PROGRESS_NO_ACTIVITY_DAYS,
    message: `No activity for ${elapsed} business days`,
  } satisfies AttentionFlag
}
