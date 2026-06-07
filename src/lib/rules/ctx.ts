// Single place where RuleContext is constructed.
// loadThresholds() reads from app_settings (with defaults fallback) — one DB round-trip per call.
// In M7 this became async. Both /api/deals and briefing.ts call `await buildRuleCtx(...)`.
import { loadThresholds } from '@/lib/db/settings'
import type { RuleContext } from './types'

export async function buildRuleCtx(
  stageMap: Record<string, string>,
  snoozedDealIds: Set<string>
): Promise<RuleContext> {
  const t = await loadThresholds()
  return {
    today: new Date(),
    timezone: 'America/New_York',
    stageMap,
    staleThresholds: t.staleThresholds,
    agreementNoFollowupDays: t.agreementNoFollowupDays,
    signedNoActivityDays: t.signedNoActivityDays,
    terminalStageIds: t.terminalStageIds,
    snoozedDealIds,
  }
}
