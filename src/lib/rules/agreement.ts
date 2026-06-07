import { businessDaysElapsed } from '@/lib/utils/business-days'
import type { Rule, AttentionFlag } from './types'

export const checkAgreement: Rule = (deal, ctx) => {
  const stageName = deal.stage ? ctx.stageMap[deal.stage] : null
  if (stageName !== 'Agreement Sent') return null

  if (!deal.lastActivityDate) return null

  const elapsed = businessDaysElapsed(deal.lastActivityDate, ctx.today)
  if (elapsed < ctx.agreementNoFollowupDays) return null

  return {
    type: 'agreement_no_followup',
    severity: 'urgent',
    daysOverdue: elapsed - ctx.agreementNoFollowupDays,
    message: `No activity for ${elapsed} business days — follow up immediately`,
  } satisfies AttentionFlag
}
