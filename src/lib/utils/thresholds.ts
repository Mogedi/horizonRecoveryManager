// Hardcoded staleness thresholds (M3). Replaced by app_settings table in M7.
// Keys are stage IDs from docs/research/pipeline-stages.json.
// Values are BUSINESS DAYS measured from stage_entered_at (how long stuck in stage).
// Absent from map = no stage-stale rule for that stage.
//
// Agreement Sent and Signed/In Progress are NOT here — they use lastActivityDate
// (no recent activity) in their own rules, not stageEnteredAt (stuck in stage).
// Putting them here too would produce duplicate flags with different semantics.
export const STAGE_STALE_THRESHOLDS_DAYS: Record<string, number> = {
  '3477730035': 5,   // Ready for Outreach
  '3477730036': 7,   // Attempted Contact
  '3477730037': 5,   // Contact Made
  '3477730038': 5,   // Follow-Up Needed
  '3477730039': 3,   // Engaged / Interested
  '3551234806': 14,  // Letter Outreach - Final Attempt
  // Omitted: New Case (3477730034) — document check rule applies, no stage staleness
  // Omitted: Agreement Sent (3477730040) — handled by agreement.ts (uses lastActivityDate)
  // Omitted: Signed / In Progress (3478695644) — handled by signed.ts (uses lastActivityDate)
}

// No staleness rules fire on terminal stages. Always check before evaluating a threshold.
export const TERMINAL_STAGE_IDS = new Set<string>([
  '3501274836', // More Research Need
  '3639720641', // F (Mortgage Foreclosures — Georgia)
  '3478695645', // Closed – Paid
  '3478695646', // Dead / Not Interested
  '3513772741', // DNC
  '3513772742', // Blocked, Missing Info
  '3741613778', // Exhausted
])

// Thresholds for specific stage rules (use last_activity_date, not stage_entered_at)
export const AGREEMENT_SENT_NO_FOLLOWUP_DAYS = 2
export const SIGNED_IN_PROGRESS_NO_ACTIVITY_DAYS = 5
