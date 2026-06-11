import { prisma } from './client'
import { PIPELINE_GROUP as _PG } from '@/lib/utils/pipeline-group'

// Re-export from shared pure module so server rules continue to import from here unchanged.
export const PIPELINE_GROUP = _PG

// Terminal stage IDs — structural, not configurable.
// These describe which stages are "done" (no rules should fire on them).
// Stage IDs confirmed in M1 (docs/research/pipeline-stages.json).
// Not stored in app_settings because changing them would require understanding HubSpot pipeline semantics.
export const TERMINAL_STAGE_IDS = new Set<string>([
  '3501274836', // More Research Need
  '3639720641', // F (Mortgage Foreclosures — Georgia)
  '3478695645', // Closed – Paid
  '3478695646', // Dead / Not Interested
  '3513772741', // DNC
  '3513772742', // Blocked, Missing Info
  '3741613778', // Exhausted
])

// Load once per sync invocation and pass to mapper — do not call repeatedly.
export async function loadStageMap(): Promise<Record<string, string>> {
  const row = await prisma.appSetting.findUnique({ where: { key: 'stage_map' } })
  if (!row) throw new Error('stage_map not found in app_settings — run db:seed')
  return JSON.parse(row.value) as Record<string, string>
}

export async function loadOwnerMap(): Promise<Record<string, string>> {
  const row = await prisma.appSetting.findUnique({ where: { key: 'owner_map' } })
  if (!row) throw new Error('owner_map not found in app_settings — run db:seed')
  return JSON.parse(row.value) as Record<string, string>
}

// ─── Threshold settings ───────────────────────────────────────────────────────

// Maps human-readable app_settings key → confirmed HubSpot stage ID.
// Stage IDs confirmed in M1 (docs/research/pipeline-stages.json).
const STAGE_KEY_MAP: Record<string, string> = {
  stage_stale_ready_for_outreach: '3477730035',
  stage_stale_attempted_contact:  '3477730036',
  stage_stale_contact_made:       '3477730037',
  stage_stale_follow_up_needed:   '3477730038',
  stage_stale_engaged_interested: '3477730039',
  stage_stale_letter_outreach:    '3551234806',
}

export const THRESHOLD_DEFAULTS: Record<string, number> = {
  stage_stale_ready_for_outreach:    5,
  stage_stale_attempted_contact:     7,
  stage_stale_contact_made:          5,
  stage_stale_follow_up_needed:      5,
  stage_stale_engaged_interested:    3,
  stage_stale_letter_outreach:       14,
  agreement_sent_no_followup_days:   2,
  signed_no_activity_days:           5,
  ai_summary_lookback_days:          28,
}

export const SETTING_META: Record<string, { label: string; group: string; unit: string }> = {
  stage_stale_ready_for_outreach:    { label: 'Ready for Outreach',                   group: 'Stage Staleness', unit: 'business days' },
  stage_stale_attempted_contact:     { label: 'Attempted Contact',                    group: 'Stage Staleness', unit: 'business days' },
  stage_stale_contact_made:          { label: 'Contact Made',                         group: 'Stage Staleness', unit: 'business days' },
  stage_stale_follow_up_needed:      { label: 'Follow-Up Needed',                     group: 'Stage Staleness', unit: 'business days' },
  stage_stale_engaged_interested:    { label: 'Engaged / Interested',                 group: 'Stage Staleness', unit: 'business days' },
  stage_stale_letter_outreach:       { label: 'Letter Outreach — Final Attempt',      group: 'Stage Staleness', unit: 'business days' },
  agreement_sent_no_followup_days:   { label: 'Agreement Sent — No Follow-Up',        group: 'Activity Rules',  unit: 'business days' },
  signed_no_activity_days:           { label: 'Signed / In Progress — No Activity',   group: 'Activity Rules',  unit: 'business days' },
  ai_summary_lookback_days:          { label: 'AI Summary Lookback Window',           group: 'AI Settings',     unit: 'days' },
}

export type Thresholds = {
  staleThresholds: Record<string, number>  // stage ID → business days
  agreementNoFollowupDays: number
  signedNoActivityDays: number
  aiSummaryLookbackDays: number
  terminalStageIds: Set<string>            // not editable — structural, not timing
}

// Load thresholds from app_settings, falling back to hardcoded defaults for any missing keys.
// Does NOT write to DB — callers get correct values whether settings have been seeded or not.
export async function loadThresholds(): Promise<Thresholds> {
  const keys = Object.keys(THRESHOLD_DEFAULTS)
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  })

  const settled: Record<string, number> = { ...THRESHOLD_DEFAULTS }
  for (const row of rows) {
    const n = parseInt(row.value, 10)
    if (!isNaN(n) && n > 0) settled[row.key] = n
  }

  const staleThresholds: Record<string, number> = {}
  for (const [key, stageId] of Object.entries(STAGE_KEY_MAP)) {
    staleThresholds[stageId] = settled[key]
  }

  return {
    staleThresholds,
    agreementNoFollowupDays: settled.agreement_sent_no_followup_days,
    signedNoActivityDays: settled.signed_no_activity_days,
    aiSummaryLookbackDays: settled.ai_summary_lookback_days,
    terminalStageIds: TERMINAL_STAGE_IDS,
  }
}

// Upsert any missing threshold keys with defaults (called from GET /api/settings).
export async function seedThresholdDefaults(): Promise<void> {
  const keys = Object.keys(THRESHOLD_DEFAULTS)
  const existing = await prisma.appSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  })
  const existingKeys = new Set(existing.map(r => r.key))
  const missing = keys.filter(k => !existingKeys.has(k))
  if (missing.length === 0) return
  await prisma.appSetting.createMany({
    data: missing.map(k => ({ key: k, value: String(THRESHOLD_DEFAULTS[k]) })),
  })
}

export type SettingItem = {
  key: string
  value: number
  label: string
  group: string
  unit: string
}

// Returns all editable settings with current values, seeding defaults for missing keys.
export async function getAllEditableSettings(): Promise<SettingItem[]> {
  await seedThresholdDefaults()

  const keys = Object.keys(THRESHOLD_DEFAULTS)
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  })

  const valueMap: Record<string, number> = { ...THRESHOLD_DEFAULTS }
  for (const row of rows) {
    const n = parseInt(row.value, 10)
    if (!isNaN(n)) valueMap[row.key] = n
  }

  return keys.map(k => ({ key: k, value: valueMap[k], ...SETTING_META[k] }))
}

// Validate and save one or more settings. Rejects unknown keys and non-positive integers.
export async function saveSettings(updates: { key: string; value: number }[]): Promise<void> {
  const knownKeys = new Set(Object.keys(THRESHOLD_DEFAULTS))
  for (const { key, value } of updates) {
    if (!knownKeys.has(key)) throw new Error(`Unknown setting key: ${key}`)
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Value for "${key}" must be a positive integer, got: ${value}`)
    }
  }
  for (const { key, value } of updates) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    })
  }
}

// ─── Agent kill switch (Phase 1 — Hermes) ───────────────────────────────────────

export const AGENT_WRITES_ENABLED_KEY = 'agent_writes_enabled'

// Maintenance-mode switch for agent (Hermes) writes. Default-ON when the key is unset, so a
// fresh DB allows writes; set the key to 'false' to instantly lock all agent mutations.
export async function areAgentWritesEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: AGENT_WRITES_ENABLED_KEY } })
  if (!row) return true
  return row.value !== 'false'
}

export async function setAgentWritesEnabled(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: AGENT_WRITES_ENABLED_KEY },
    create: { key: AGENT_WRITES_ENABLED_KEY, value: String(enabled) },
    update: { value: String(enabled) },
  })
}
