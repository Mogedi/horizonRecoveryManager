import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// vi.mock is hoisted above all imports by Vitest's transformer
vi.mock('@/lib/db/client', () => ({
  prisma: {
    appSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      createMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/client'
import { saveSettings, loadThresholds, THRESHOLD_DEFAULTS, SETTING_META } from './settings'

const mockFindMany = vi.mocked(prisma.appSetting.findMany)
const mockUpsert   = vi.mocked(prisma.appSetting.upsert)

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── saveSettings — validation ────────────────────────────────────────────────

describe('saveSettings — validation', () => {
  beforeEach(() => {
    mockUpsert.mockResolvedValue({} as Awaited<ReturnType<typeof mockUpsert>>)
  })

  it('throws on unknown setting key', async () => {
    await expect(
      saveSettings([{ key: 'made_up_key', value: 5 }])
    ).rejects.toThrow('Unknown setting key')
  })

  it('throws when value is 0', async () => {
    await expect(
      saveSettings([{ key: 'stage_stale_attempted_contact', value: 0 }])
    ).rejects.toThrow('positive integer')
  })

  it('throws when value is negative', async () => {
    await expect(
      saveSettings([{ key: 'stage_stale_attempted_contact', value: -1 }])
    ).rejects.toThrow('positive integer')
  })

  it('throws when value is not an integer', async () => {
    await expect(
      saveSettings([{ key: 'stage_stale_attempted_contact', value: 3.5 }])
    ).rejects.toThrow('positive integer')
  })

  it('accepts a valid positive integer for a known key', async () => {
    await expect(
      saveSettings([{ key: 'stage_stale_attempted_contact', value: 10 }])
    ).resolves.toBeUndefined()
    expect(mockUpsert).toHaveBeenCalledOnce()
  })

  it('validates all entries before writing any — rejects on second item with bad key', async () => {
    await expect(
      saveSettings([
        { key: 'stage_stale_attempted_contact', value: 5 },
        { key: 'unknown_key', value: 5 },
      ])
    ).rejects.toThrow('Unknown setting key')
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

// ─── loadThresholds — fallback behavior ───────────────────────────────────────

describe('loadThresholds — DB fallback', () => {
  it('returns all hardcoded defaults when DB is empty', async () => {
    mockFindMany.mockResolvedValue([])
    const t = await loadThresholds()
    expect(t.agreementNoFollowupDays).toBe(THRESHOLD_DEFAULTS.agreement_sent_no_followup_days)
    expect(t.signedNoActivityDays).toBe(THRESHOLD_DEFAULTS.signed_no_activity_days)
    expect(t.aiSummaryLookbackDays).toBe(THRESHOLD_DEFAULTS.ai_summary_lookback_days)
    expect(Object.keys(t.staleThresholds).length).toBeGreaterThan(0)
  })

  it('overrides defaults with valid DB values', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'stage_stale_attempted_contact', value: '14' },
    ] as Awaited<ReturnType<typeof mockFindMany>>)
    const t = await loadThresholds()
    // Attempted Contact maps to stage ID 3477730036
    expect(t.staleThresholds['3477730036']).toBe(14)
  })

  it('ignores NaN DB values and falls back to the hardcoded default', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'stage_stale_attempted_contact', value: 'not-a-number' },
    ] as Awaited<ReturnType<typeof mockFindMany>>)
    const t = await loadThresholds()
    // Default for attempted_contact is 7
    expect(t.staleThresholds['3477730036']).toBe(7)
  })

  it('ignores zero DB values and falls back to the hardcoded default', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'stage_stale_attempted_contact', value: '0' },
    ] as Awaited<ReturnType<typeof mockFindMany>>)
    const t = await loadThresholds()
    expect(t.staleThresholds['3477730036']).toBe(7)
  })

  it('terminalStageIds always includes known terminal stages', async () => {
    mockFindMany.mockResolvedValue([])
    const t = await loadThresholds()
    expect(t.terminalStageIds).toBeInstanceOf(Set)
    expect(t.terminalStageIds.has('3478695645')).toBe(true) // Closed – Paid
    expect(t.terminalStageIds.has('3478695646')).toBe(true) // Dead / Not Interested
    expect(t.terminalStageIds.has('3513772741')).toBe(true) // DNC
    expect(t.terminalStageIds.has('3513772742')).toBe(true) // Blocked, Missing Info
    expect(t.terminalStageIds.has('3741613778')).toBe(true) // Exhausted
    expect(t.terminalStageIds.has('3501274836')).toBe(true) // More Research Need
    expect(t.terminalStageIds.has('3639720641')).toBe(true) // F
  })

  it('terminalStageIds never includes active stages used in staleness rules', async () => {
    mockFindMany.mockResolvedValue([])
    const t = await loadThresholds()
    expect(t.terminalStageIds.has('3477730036')).toBe(false) // Attempted Contact
    expect(t.terminalStageIds.has('3477730040')).toBe(false) // Agreement Sent
    expect(t.terminalStageIds.has('3478695644')).toBe(false) // Signed / In Progress
  })
})

// ─── THRESHOLD_DEFAULTS / SETTING_META consistency ───────────────────────────

describe('THRESHOLD_DEFAULTS and SETTING_META are in sync', () => {
  it('every default key has a SETTING_META entry', () => {
    for (const key of Object.keys(THRESHOLD_DEFAULTS)) {
      expect(SETTING_META[key], `Missing SETTING_META for "${key}"`).toBeDefined()
    }
  })

  it('every SETTING_META key has a default', () => {
    for (const key of Object.keys(SETTING_META)) {
      expect(THRESHOLD_DEFAULTS[key], `Missing default for "${key}"`).toBeDefined()
    }
  })

  it('all defaults are positive integers', () => {
    for (const [key, value] of Object.entries(THRESHOLD_DEFAULTS)) {
      expect(
        Number.isInteger(value) && value > 0,
        `Bad default for "${key}": ${value}`
      ).toBe(true)
    }
  })
})

// ─── Stage label integrity (reads real research fixture) ─────────────────────

describe('Stage label integrity — pipeline-stages.json', () => {
  const root = resolve(process.cwd())
  const raw = readFileSync(`${root}/docs/research/pipeline-stages.json`, 'utf8')
  const pipelineData = JSON.parse(raw)
  const stages: Array<{ id: string; label: string }> = pipelineData.results[0].stages

  it('Agreement Sent (3477730040) label trims to "Agreement Sent"', () => {
    const s = stages.find(x => x.id === '3477730040')
    expect(s).toBeDefined()
    expect(s!.label.trim()).toBe('Agreement Sent')
  })

  it('Signed / In Progress (3478695644) label trims to "Signed / In Progress"', () => {
    const s = stages.find(x => x.id === '3478695644')
    expect(s).toBeDefined()
    expect(s!.label.trim()).toBe('Signed / In Progress')
  })

  it('all stage labels are non-empty after trim (seed script calls .trim() before storing)', () => {
    // Follow-Up Needed has a trailing space in raw JSON — .trim() handles it
    for (const s of stages) {
      expect(s.label.trim().length, `Stage ${s.id} has empty label after trim`).toBeGreaterThan(0)
    }
  })

  it('all 6 stages used in staleness rules are present', () => {
    const stageIds = new Set(stages.map(s => s.id))
    const active = {
      '3477730035': 'Ready for Outreach',
      '3477730036': 'Attempted Contact',
      '3477730037': 'Contact Made',
      '3477730038': 'Follow-Up Needed',
      '3477730039': 'Engaged / Interested',
      '3551234806': 'Letter Outreach - Final Attempt',
    }
    for (const [id, name] of Object.entries(active)) {
      expect(stageIds.has(id), `Missing stage "${name}" (${id})`).toBe(true)
    }
  })

  it('all 7 terminal stages are present in the fixture', () => {
    const stageIds = new Set(stages.map(s => s.id))
    const terminal = {
      '3501274836': 'More Research Need',
      '3639720641': 'F',
      '3478695645': 'Closed – Paid',
      '3478695646': 'Dead / Not Interested',
      '3513772741': 'DNC',
      '3513772742': 'Blocked, Missing Info',
      '3741613778': 'Exhausted',
    }
    for (const [id, name] of Object.entries(terminal)) {
      expect(stageIds.has(id), `Missing terminal stage "${name}" (${id})`).toBe(true)
    }
  })
})
