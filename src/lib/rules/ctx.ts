// Single place where RuleContext is constructed from thresholds.
// In M7 this function becomes async and reads thresholds from app_settings.
// Both /api/deals and briefing.ts use this — updating one place updates both.
import {
  STAGE_STALE_THRESHOLDS_DAYS,
  TERMINAL_STAGE_IDS,
  AGREEMENT_SENT_NO_FOLLOWUP_DAYS,
  SIGNED_IN_PROGRESS_NO_ACTIVITY_DAYS,
} from '@/lib/utils/thresholds'
import type { RuleContext } from './types'

export function buildRuleCtx(
  stageMap: Record<string, string>,
  snoozedDealIds: Set<string>
): RuleContext {
  return {
    today: new Date(),
    timezone: 'America/New_York',
    stageMap,
    staleThresholds: STAGE_STALE_THRESHOLDS_DAYS,
    agreementNoFollowupDays: AGREEMENT_SENT_NO_FOLLOWUP_DAYS,
    signedNoActivityDays: SIGNED_IN_PROGRESS_NO_ACTIVITY_DAYS,
    terminalStageIds: TERMINAL_STAGE_IDS,
    snoozedDealIds,
  }
}
