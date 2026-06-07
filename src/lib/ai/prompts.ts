import type { NormalizedDeal } from '@/lib/rules/types'

type Contact = {
  id: number
  contactHubspotId: string | null
  name: string | null
  contactType: string | null
  ownershipStatus: string | null
  isDeceased: boolean
  doNotContact: boolean
  phoneNumbers: unknown
  emailList: unknown
}

type Activity = {
  id: number
  type: string
  body: string | null
  authorOwnerId: string | null
  direction: string | null
  timestamp: Date | null
  metadata: unknown
  syncedAt: Date
}

const JSON_INSTRUCTION = `Return ONLY a valid JSON object with exactly these keys. No other text, no markdown, no code fences.

{
  "current_status": "one sentence on where this case stands right now",
  "last_meaningful_activity": "what happened and when (be specific)",
  "blockers": ["list any blockers, or empty array if none"],
  "who_needs_something": "who is waiting on whom, or null if nobody",
  "suggested_next_step": "the single most important thing Mo should do next",
  "mo_action_required": true,
  "documents_mentioned_missing": ["any missing docs mentioned in notes, or empty array"]
}`

export function buildSummaryPrompt(
  deal: NormalizedDeal,
  contacts: Contact[],
  activities: Activity[],
  stageMap: Record<string, string>,
  lookbackDays: number
): string {
  const stageName = deal.stage ? (stageMap[deal.stage] ?? deal.stage) : 'Unknown'
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - lookbackDays)

  const recentActivities = activities
    .filter(a => a.timestamp && a.timestamp >= cutoff)
    .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))

  const contactLines = contacts
    .map(c => {
      const flags = [
        c.isDeceased ? 'DECEASED' : null,
        c.doNotContact ? 'DNC' : null,
      ].filter(Boolean)
      return `  - ${c.name ?? 'Unknown'} (${c.contactType ?? 'unknown type'})${flags.length ? ` [${flags.join(', ')}]` : ''}`
    })
    .join('\n')

  const activityLines = recentActivities
    .map(a => {
      const date = a.timestamp ? a.timestamp.toISOString().slice(0, 10) : 'unknown date'
      const dir = a.direction ? ` [${a.direction}]` : ''
      return `  [${a.type.toUpperCase()}${dir}] ${date}: ${a.body ?? '(no body)'}`
    })
    .join('\n')

  return `You are analyzing a surplus funds recovery case for Horizon Recovery LLC.

DEAL: ${deal.name ?? 'Unknown'}
STAGE: ${stageName}
SURPLUS AMOUNT: $${deal.amount ?? 0}
DAYS IN CURRENT STAGE: ${deal.stageEnteredAt ? Math.floor((Date.now() - deal.stageEnteredAt.getTime()) / 86400000) : 'unknown'}

CONTACTS (${contacts.length}):
${contactLines || '  (none)'}

RECENT ACTIVITY (last ${lookbackDays} days, ${recentActivities.length} of ${activities.length} total):
${activityLines || '  (no recent activity)'}

${JSON_INSTRUCTION}`
}
