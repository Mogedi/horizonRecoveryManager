import { businessDaysElapsed } from '@/lib/utils/business-days'
import { AGREEMENT_SENT_NO_FOLLOWUP_DAYS } from '@/lib/utils/thresholds'
import type { Rule, AttentionFlag } from './types'

export const checkAgreement: Rule = (deal, ctx) => {
  const stageName = deal.stage ? ctx.stageMap[deal.stage] : null
  if (stageName !== 'Agreement Sent') return null

  if (!deal.lastActivityDate) return null

  const elapsed = businessDaysElapsed(deal.lastActivityDate, ctx.today)
  if (elapsed < AGREEMENT_SENT_NO_FOLLOWUP_DAYS) return null

  return {
    type: 'agreement_no_followup',
    severity: 'urgent',
    daysOverdue: elapsed - AGREEMENT_SENT_NO_FOLLOWUP_DAYS,
    message: `No activity for ${elapsed} business days — follow up immediately`,
  } satisfies AttentionFlag
}
