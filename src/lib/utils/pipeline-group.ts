export type PipelineGroupId = 'setup' | 'outreach' | 'case_mgmt' | 'terminal'

// Stage ID → pipeline group. Stage IDs confirmed in docs/research/pipeline-stages.json.
// Structural constant — not configurable. Shared between server (settings.ts) and client (DealPanel).
export const PIPELINE_GROUP: Record<string, PipelineGroupId> = {
  '3501274836': 'terminal',   // More Research Need
  '3639720641': 'terminal',   // F (Mortgage Foreclosures — Georgia)
  '3477730034': 'setup',      // New Case
  '3477730035': 'setup',      // Ready for Outreach
  '3477730036': 'outreach',   // Attempted Contact
  '3477730037': 'outreach',   // Contact Made
  '3477730038': 'outreach',   // Follow-Up Needed
  '3477730039': 'outreach',   // Engaged / Interested
  '3551234806': 'outreach',   // Letter Outreach - Final Attempt
  '3477730040': 'case_mgmt',  // Agreement Sent
  '3478695644': 'case_mgmt',  // Signed / In Progress
  '3478695645': 'terminal',   // Closed – Paid
  '3478695646': 'terminal',   // Dead / Not Interested
  '3513772741': 'terminal',   // DNC
  '3513772742': 'terminal',   // Blocked, Missing Info
  '3741613778': 'terminal',   // Exhausted
}

export function getPipelineGroup(stageId: string | null): PipelineGroupId {
  if (!stageId) return 'terminal'
  return PIPELINE_GROUP[stageId] ?? 'terminal'
}

export function defaultTabForPipelineGroup(
  group: PipelineGroupId
): 'story' | 'contacts' | 'calls' {
  if (group === 'setup') return 'contacts'
  if (group === 'outreach') return 'calls'
  return 'story'
}
