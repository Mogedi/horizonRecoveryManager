import { describe, it, expect } from 'vitest'
import { computeOutreachMatrix, type RawContact, type RawEvent } from './outreach'

// Fixture contacts — based on real deal 321285583585 (TROUP - James Baker), simplified to 2 contacts.
// Phone numbers and IDs are real values from docs/research/outreach-fixtures.json.
const JAMES: RawContact = {
  contactHubspotId: '473038900962',
  name: 'James Baker',
  contactType: null,
  phoneNumbers: ['+17069751509', '+17066685460'],
}

const LATOSHA: RawContact = {
  contactHubspotId: '473038900970',
  name: 'Latosha Lockhart',
  contactType: null,
  phoneNumbers: ['+19123143349', '+19125314866'],
}

// 6 fixture events across 2 outreach days.
// fromNumber is Kathleen's JustCall line (constant in real data: +14782802726).
// Dates chosen to be distinct calendar days (midnight UTC = that day in JustCall account tz).
const DAY1 = '2026-04-22T00:00:00.000Z'
const DAY2 = '2026-04-23T00:00:00.000Z'

const EVENTS: RawEvent[] = [
  // Day 1 — 3 calls, 1 answered (James)
  { happenedAt: DAY1, direction: 'outbound', outcome: 'answered',  toNumber: '+17069751509', fromNumber: '+14782802726', durationSecs: 23 },
  { happenedAt: DAY1, direction: 'outbound', outcome: 'no_answer', toNumber: '+17066685460', fromNumber: '+14782802726', durationSecs: 0  },
  { happenedAt: DAY1, direction: 'outbound', outcome: 'no_answer', toNumber: '+19123143349', fromNumber: '+14782802726', durationSecs: 0  },
  // Day 2 — 3 calls, 1 answered (Latosha), 1 voicemail (James)
  { happenedAt: DAY2, direction: 'outbound', outcome: 'voicemail', toNumber: '+17069751509', fromNumber: '+14782802726', durationSecs: 32 },
  { happenedAt: DAY2, direction: 'outbound', outcome: 'answered',  toNumber: '+19123143349', fromNumber: '+14782802726', durationSecs: 45 },
  { happenedAt: DAY2, direction: 'outbound', outcome: 'no_answer', toNumber: '+19125314866', fromNumber: '+14782802726', durationSecs: 0  },
]

describe('computeOutreachMatrix', () => {
  const matrix = computeOutreachMatrix('321285583585', [JAMES, LATOSHA], EVENTS)

  // ── Top-level summary ──────────────────────────────────────────────────────

  it('counts distinct outreach days', () => {
    expect(matrix.outreachDays).toBe(2)
  })

  it('counts total outbound calls', () => {
    expect(matrix.totalOutboundCalls).toBe(6)
  })

  it('counts total contacts', () => {
    expect(matrix.contactsTotal).toBe(2)
  })

  it('counts contacts reached (at least one answered call)', () => {
    expect(matrix.contactsReached).toBe(2)
  })

  it('sets lastCalledAt to the most recent call date', () => {
    expect(matrix.lastCalledAt).toEqual(new Date(DAY2))
  })

  // ── Contact-level ──────────────────────────────────────────────────────────

  it('includes all contacts', () => {
    const names = matrix.contacts.map(c => c.name)
    expect(names).toContain('James Baker')
    expect(names).toContain('Latosha Lockhart')
  })

  it('marks James Baker as reached (has an answered call)', () => {
    const james = matrix.contacts.find(c => c.name === 'James Baker')!
    expect(james.reached).toBe(true)
  })

  it('marks Latosha Lockhart as reached (has an answered call)', () => {
    const latosha = matrix.contacts.find(c => c.name === 'Latosha Lockhart')!
    expect(latosha.reached).toBe(true)
  })

  it('includes all phones for James Baker', () => {
    const james = matrix.contacts.find(c => c.name === 'James Baker')!
    const nums = james.phones.map(p => p.numberE164)
    expect(nums).toContain('+17069751509')
    expect(nums).toContain('+17066685460')
  })

  it('counts total attempts per contact', () => {
    const james = matrix.contacts.find(c => c.name === 'James Baker')!
    expect(james.totalAttempts).toBe(3) // 2 on +17069751509, 1 on +17066685460
  })

  // ── Phone-level ────────────────────────────────────────────────────────────

  it('records attempt history on a phone', () => {
    const james = matrix.contacts.find(c => c.name === 'James Baker')!
    const primary = james.phones.find(p => p.numberE164 === '+17069751509')!
    expect(primary.attempts).toHaveLength(2)
    expect(primary.attempts[0].outcome).toBe('answered')
    expect(primary.attempts[1].outcome).toBe('voicemail')
  })

  it('sets everAnswered=true when at least one call was answered', () => {
    const james = matrix.contacts.find(c => c.name === 'James Baker')!
    const primary = james.phones.find(p => p.numberE164 === '+17069751509')!
    expect(primary.everAnswered).toBe(true)
  })

  it('sets everAnswered=false when no call was answered', () => {
    const james = matrix.contacts.find(c => c.name === 'James Baker')!
    const secondary = james.phones.find(p => p.numberE164 === '+17066685460')!
    expect(secondary.everAnswered).toBe(false)
  })

  it('sets lastOutcome to the most recent call outcome', () => {
    const james = matrix.contacts.find(c => c.name === 'James Baker')!
    const primary = james.phones.find(p => p.numberE164 === '+17069751509')!
    expect(primary.lastOutcome).toBe('voicemail') // answered Apr22, voicemail Apr23
  })

  it('sets lastCalledAt per phone', () => {
    const james = matrix.contacts.find(c => c.name === 'James Baker')!
    const primary = james.phones.find(p => p.numberE164 === '+17069751509')!
    expect(primary.lastCalledAt).toEqual(new Date(DAY2))
  })

  it('leaves phones with zero calls showing no attempts', () => {
    const latosha = matrix.contacts.find(c => c.name === 'Latosha Lockhart')!
    // +19125314866 was only called on Day 2 with no_answer
    const secondary = latosha.phones.find(p => p.numberE164 === '+19125314866')!
    expect(secondary.attempts).toHaveLength(1)
    expect(secondary.everAnswered).toBe(false)
  })

  // ── Day summaries ──────────────────────────────────────────────────────────

  it('produces one day summary per distinct outreach day', () => {
    expect(matrix.days).toHaveLength(2)
  })

  it('orders days chronologically', () => {
    expect(matrix.days[0].date).toBe('2026-04-22')
    expect(matrix.days[1].date).toBe('2026-04-23')
  })

  it('counts calls per day', () => {
    expect(matrix.days[0].callCount).toBe(3)
    expect(matrix.days[1].callCount).toBe(3)
  })

  it('counts answered calls per day', () => {
    expect(matrix.days[0].answeredCount).toBe(1)
    expect(matrix.days[1].answeredCount).toBe(1)
  })

  it('lists contacts reached each day by name', () => {
    expect(matrix.days[0].contactsReached).toEqual(['James Baker'])
    expect(matrix.days[1].contactsReached).toEqual(['Latosha Lockhart'])
  })

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('handles a contact with no calls at all', () => {
    const noCallContact: RawContact = {
      contactHubspotId: '999',
      name: 'Never Called',
      contactType: null,
      phoneNumbers: ['+15551234567'],
    }
    const result = computeOutreachMatrix('x', [noCallContact], [])
    const contact = result.contacts[0]
    expect(contact.reached).toBe(false)
    expect(contact.totalAttempts).toBe(0)
    expect(contact.phones[0].attempts).toHaveLength(0)
    expect(contact.phones[0].everAnswered).toBe(false)
    expect(contact.phones[0].lastOutcome).toBeNull()
  })

  it('handles a phone number shared across two contacts', () => {
    const sharedPhone = '+17068459715'
    const c1: RawContact = { contactHubspotId: '1', name: 'Alice', contactType: null, phoneNumbers: [sharedPhone] }
    const c2: RawContact = { contactHubspotId: '2', name: 'Bob', contactType: null, phoneNumbers: [sharedPhone] }
    const ev: RawEvent = { happenedAt: DAY1, direction: 'outbound', outcome: 'answered', toNumber: sharedPhone, fromNumber: '+14782802726', durationSecs: 30 }
    const result = computeOutreachMatrix('x', [c1, c2], [ev])
    // Both contacts should see the call — shared number
    expect(result.contacts.find(c => c.name === 'Alice')!.reached).toBe(true)
    expect(result.contacts.find(c => c.name === 'Bob')!.reached).toBe(true)
    // contactsReached should not double-count unique contacts
    expect(result.contactsReached).toBe(2)
  })

  it('ignores inbound calls when counting outreach attempts', () => {
    const ev: RawEvent = { happenedAt: DAY1, direction: 'inbound', outcome: 'answered', toNumber: '+14782802726', fromNumber: '+17069751509', durationSecs: 60 }
    const result = computeOutreachMatrix('x', [JAMES], [ev])
    // Inbound calls don't count as outreach days or outreach attempts
    expect(result.outreachDays).toBe(0)
    expect(result.totalOutboundCalls).toBe(0)
    // But James is still in the contacts list with 0 attempts
    expect(result.contacts[0].totalAttempts).toBe(0)
  })

  it('returns zero stats for a deal with no events', () => {
    const result = computeOutreachMatrix('x', [JAMES], [])
    expect(result.outreachDays).toBe(0)
    expect(result.totalOutboundCalls).toBe(0)
    expect(result.contactsReached).toBe(0)
    expect(result.lastCalledAt).toBeNull()
    expect(result.days).toHaveLength(0)
  })

  it('normalizes non-E.164 phone numbers stored in deal_contacts', () => {
    // HubSpot sometimes stores numbers without the leading + (e.g. "14788324342" instead of "+14788324342").
    // The matrix must still match these against E.164 numbers in activity_events.
    const contact: RawContact = {
      contactHubspotId: '100',
      name: 'Rosa Davis',
      contactType: null,
      phoneNumbers: ['14789604086'],  // missing leading +
    }
    const ev: RawEvent = {
      happenedAt: DAY1,
      direction: 'outbound',
      outcome: 'answered',
      toNumber: '+14789604086',   // E.164 as stored in activity_events
      fromNumber: '+14782802726',
      durationSecs: 45,
    }
    const result = computeOutreachMatrix('x', [contact], [ev])
    expect(result.contacts[0].reached).toBe(true)
    expect(result.contacts[0].phones[0].everAnswered).toBe(true)
    expect(result.contacts[0].phones[0].numberE164).toBe('+14789604086')
  })
})
