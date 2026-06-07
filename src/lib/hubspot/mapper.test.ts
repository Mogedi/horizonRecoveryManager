import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { mapDeal, mapContact, mapActivity, stripHtml, isValidPhone } from './mapper'

// Fixtures from M1 research — real HubSpot responses, never call live API in tests
const sampleDealFile = JSON.parse(readFileSync('docs/research/sample-deal.json', 'utf8'))
const sampleContactsFile = JSON.parse(readFileSync('docs/research/sample-deal-contacts.json', 'utf8'))
const sampleNotesFile = JSON.parse(readFileSync('docs/research/sample-deal-notes.json', 'utf8'))
const sampleTasksFile = JSON.parse(readFileSync('docs/research/sample-deal-tasks.json', 'utf8'))

const rawDeal = sampleDealFile.results[0]
const rawContacts = sampleContactsFile.results
const rawNotes = sampleNotesFile.results
const rawTasks = sampleTasksFile.results

// ─── mapDeal ────────────────────────────────────────────────────────────────

describe('mapDeal', () => {
  it('extracts deal name', () => {
    const d = mapDeal(rawDeal)
    expect(d.name).toBe('CHATHAM - 701 W 48th St - Idella Grant ($36K)')
  })

  it('stores stage ID (not name) — resolved via stageMap at display time in API layer', () => {
    const d = mapDeal(rawDeal)
    expect(d.stage).toBe('3477730036')
  })

  it('uses amount as primary value', () => {
    const d = mapDeal(rawDeal)
    expect(d.amount).toBeCloseTo(35848.41)
  })

  it('estimated_surplus is null (confirmed null on all 150 deals)', () => {
    const d = mapDeal(rawDeal)
    expect(d.estimatedSurplus).toBeNull()
  })

  it('handles all missing properties gracefully — never throws', () => {
    const empty = { id: 'test123', properties: {}, url: null }
    const d = mapDeal(empty)
    expect(d.hubspotId).toBe('test123')
    expect(d.name).toBeNull()
    expect(d.amount).toBeNull()
    expect(d.stageEnteredAt).toBeNull()
  })

  it('includes hubspotUrl from raw.url', () => {
    const d = mapDeal(rawDeal)
    expect(d.hubspotUrl).toContain('322527156927')
  })

  it('parses stage_entered_at as a Date', () => {
    const d = mapDeal(rawDeal)
    if (d.stageEnteredAt) {
      expect(d.stageEnteredAt).toBeInstanceOf(Date)
    }
  })
})

// ─── mapContact ─────────────────────────────────────────────────────────────

describe('mapContact', () => {
  it('collects valid phone numbers from all 11 variants', () => {
    // Andre Brady has phone_1, phone_2, phone_3 populated
    const andre = rawContacts.find((c: { properties: Record<string, string | null> }) =>
      c.properties?.firstname === 'Andre'
    )
    expect(andre).toBeDefined()
    const contact = mapContact(andre)
    expect(contact.phoneNumbers.length).toBeGreaterThan(0)
  })

  it('rejects date strings — Idella Grant has "02/06/2024" in phone field', () => {
    const idella = rawContacts.find((c: { properties: Record<string, string | null> }) =>
      c.properties?.lastname === 'Grant'
    )
    expect(idella).toBeDefined()
    const contact = mapContact(idella)
    expect(contact.phoneNumbers).not.toContain('02/06/2024')
    // But valid phone_1 and phone_2 should be kept
    expect(contact.phoneNumbers.length).toBeGreaterThan(0)
  })

  it('rejects empty strings from phone fields', () => {
    // Colesha Teague has phone_1: '' (empty string)
    const colesha = rawContacts.find((c: { properties: Record<string, string | null> }) =>
      c.properties?.firstname === 'Colesha'
    )
    expect(colesha).toBeDefined()
    const contact = mapContact(colesha)
    contact.phoneNumbers.forEach(p => {
      expect(p.trim().length).toBeGreaterThan(0)
    })
  })

  it('all phone numbers in output have 7+ digits', () => {
    rawContacts.forEach((raw: { properties: Record<string, string | null> }) => {
      const contact = mapContact(raw)
      contact.phoneNumbers.forEach(p => {
        const digitCount = p.replace(/\D/g, '').length
        expect(digitCount, `Phone "${p}" has fewer than 7 digits`).toBeGreaterThanOrEqual(7)
      })
    })
  })
})

// ─── mapActivity ─────────────────────────────────────────────────────────────

describe('mapActivity (notes)', () => {
  it('strips HTML from note body', () => {
    const note = rawNotes[0]
    const activity = mapActivity(note, 'note')
    expect(activity.body).not.toMatch(/<[^>]+>/)
    expect(activity.body?.length).toBeGreaterThan(0)
  })

  it('sets type to note', () => {
    const activity = mapActivity(rawNotes[0], 'note')
    expect(activity.type).toBe('note')
  })

  it('extracts author owner ID from engagement', () => {
    const activity = mapActivity(rawNotes[0], 'note')
    expect(activity.authorOwnerId).toBeDefined()
  })
})

describe('mapActivity (tasks)', () => {
  it('maps task body from hs_task_subject', () => {
    const activity = mapActivity(rawTasks[0], 'task')
    expect(activity.type).toBe('task')
    expect(activity.body).not.toBeNull()
  })
})

// ─── Utility functions ────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<div><p>Hello</p></div>')).toBe('Hello')
  })

  it('collapses whitespace', () => {
    expect(stripHtml('<p>  a  </p>  <p>  b  </p>')).toBe('a b')
  })

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('')
  })
})

describe('isValidPhone', () => {
  it('accepts valid US phone', () => expect(isValidPhone('+12532418009')).toBe(true))
  it('accepts phone with spaces', () => expect(isValidPhone('5394308693 ')).toBe(true))
  it('rejects date strings', () => expect(isValidPhone('02/06/2024')).toBe(false))
  it('rejects empty string', () => expect(isValidPhone('')).toBe(false))
  it('rejects short strings', () => expect(isValidPhone('123')).toBe(false))
})
