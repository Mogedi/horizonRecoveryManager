import { describe, it, expect } from 'vitest'
import {
  computeOutreachMatrix,
  deriveDetailedOutcome,
  classifyVoicemailSubtype,
  type RawContact,
  type RawEvent,
} from './outreach'

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

  it('orders days newest first', () => {
    expect(matrix.days[0].date).toBe('2026-04-23')  // most recent
    expect(matrix.days[1].date).toBe('2026-04-22')  // older
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
    const day22 = matrix.days.find(d => d.date === '2026-04-22')!
    const day23 = matrix.days.find(d => d.date === '2026-04-23')!
    expect(day22.contactsReached).toEqual(['James Baker'])
    expect(day23.contactsReached).toEqual(['Latosha Lockhart'])
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

// ── Session drilldown (calls per day) ──────────────────────────────────────────

describe('computeOutreachMatrix — session calls per day', () => {
  // Enrich EVENTS with id fields to test activityEventId mapping
  const enrichedEvents: RawEvent[] = [
    { id: 1, happenedAt: DAY1, direction: 'outbound', outcome: 'answered',  toNumber: '+17069751509', fromNumber: '+14782802726', durationSecs: 23 },
    { id: 2, happenedAt: DAY1, direction: 'outbound', outcome: 'no_answer', toNumber: '+17066685460', fromNumber: '+14782802726', durationSecs: 0  },
    { id: 3, happenedAt: DAY1, direction: 'outbound', outcome: 'no_answer', toNumber: '+19123143349', fromNumber: '+14782802726', durationSecs: 0  },
    { id: 4, happenedAt: DAY2, direction: 'outbound', outcome: 'voicemail', toNumber: '+17069751509', fromNumber: '+14782802726', durationSecs: 32 },
    { id: 5, happenedAt: DAY2, direction: 'outbound', outcome: 'answered',  toNumber: '+19123143349', fromNumber: '+14782802726', durationSecs: 45 },
    { id: 6, happenedAt: DAY2, direction: 'outbound', outcome: 'no_answer', toNumber: '+19125314866', fromNumber: '+14782802726', durationSecs: 0  },
  ]
  const matrix = computeOutreachMatrix('321285583585', [JAMES, LATOSHA], enrichedEvents)

  it('each day has a calls array matching callCount', () => {
    expect(matrix.days[0].calls).toHaveLength(3)
    expect(matrix.days[1].calls).toHaveLength(3)
  })

  it('calls within a day are sorted chronologically', () => {
    const day1 = matrix.days[0].calls
    for (let i = 1; i < day1.length; i++) {
      expect(day1[i].happenedAt.getTime()).toBeGreaterThanOrEqual(day1[i - 1].happenedAt.getTime())
    }
  })

  it('resolves contact name from phone number', () => {
    const day1 = matrix.days[0].calls
    const jamesCall = day1.find(c => c.phoneNumber === '+17069751509')!
    expect(jamesCall.contactName).toBe('James Baker')
  })

  it('sets contactHubspotId from phone number match', () => {
    const day1 = matrix.days[0].calls
    const jamesCall = day1.find(c => c.phoneNumber === '+17069751509')!
    expect(jamesCall.contactHubspotId).toBe('473038900962')
  })

  it('maps activityEventId from id field', () => {
    const day22 = matrix.days.find(d => d.date === '2026-04-22')!
    const firstCall = day22.calls[0]
    expect(firstCall.activityEventId).toBe(1)
  })

  it('activityEventId defaults to 0 when id is absent', () => {
    const eventsWithoutId: RawEvent[] = [
      { happenedAt: DAY1, direction: 'outbound', outcome: 'answered', toNumber: '+17069751509', fromNumber: '+14782802726', durationSecs: 30 },
    ]
    const result = computeOutreachMatrix('x', [JAMES], eventsWithoutId)
    expect(result.days[0].calls[0].activityEventId).toBe(0)
  })

  it('sets contactName to null when phone is not in any contact', () => {
    const unknownPhoneEvent: RawEvent = {
      id: 99,
      happenedAt: DAY1,
      direction: 'outbound',
      outcome: 'no_answer',
      toNumber: '+10000000000',  // not in any contact
      fromNumber: '+14782802726',
      durationSecs: 0,
    }
    const result = computeOutreachMatrix('x', [JAMES], [unknownPhoneEvent])
    expect(result.days[0].calls[0].contactName).toBeNull()
    expect(result.days[0].calls[0].contactHubspotId).toBeNull()
  })

  it('sets outcome correctly on each call', () => {
    const day22 = matrix.days.find(d => d.date === '2026-04-22')!.calls
    const jamesCall = day22.find(c => c.phoneNumber === '+17069751509')!
    expect(jamesCall.outcome).toBe('answered')
    const noAnswerCall = day22.find(c => c.phoneNumber === '+17066685460')!
    expect(noAnswerCall.outcome).toBe('no_answer')
  })
})

// ── transcriptStatus logic ─────────────────────────────────────────────────────

describe('computeOutreachMatrix — transcriptStatus', () => {
  const base = (overrides: Partial<RawEvent>): RawEvent => ({
    happenedAt: DAY1,
    direction: 'outbound',
    outcome: 'answered',
    toNumber: '+17069751509',
    fromNumber: '+14782802726',
    durationSecs: 30,
    ...overrides,
  })

  function getStatus(ev: RawEvent) {
    const result = computeOutreachMatrix('x', [JAMES], [ev])
    return result.days[0].calls[0].transcriptStatus
  }

  it('returns available when transcript text is present', () => {
    expect(getStatus(base({ transcript: 'Please leave a message after the beep.' }))).toBe('available')
  })

  it('returns too_short when durationSecs is 0', () => {
    expect(getStatus(base({ durationSecs: 0 }))).toBe('too_short')
  })

  it('returns too_short when durationSecs is 3', () => {
    expect(getStatus(base({ durationSecs: 3 }))).toBe('too_short')
  })

  it('returns too_short when durationSecs is null (unknown short call)', () => {
    expect(getStatus(base({ durationSecs: null }))).toBe('too_short')
  })

  it('does NOT return too_short when durationSecs is 4 or more', () => {
    expect(getStatus(base({ durationSecs: 4 }))).not.toBe('too_short')
  })

  it('returns no_recording when hasRecording is explicitly false', () => {
    expect(getStatus(base({ durationSecs: 30, hasRecording: false }))).toBe('no_recording')
  })

  it('returns not_started when call is long enough, has a recording, but no transcript yet', () => {
    expect(getStatus(base({ durationSecs: 30, hasRecording: true }))).toBe('not_started')
  })

  it('returns not_started when hasRecording is undefined (legacy events)', () => {
    expect(getStatus(base({ durationSecs: 30 }))).toBe('not_started')
  })

  it('transcript: available takes priority over too_short duration', () => {
    // A transcript was produced from a 2s clip — unusual but possible
    expect(getStatus(base({ durationSecs: 2, transcript: 'The number is not in service.' }))).toBe('available')
  })
})

// ── displaySummary derivation ──────────────────────────────────────────────────

describe('computeOutreachMatrix — displaySummary', () => {
  const base = (overrides: Partial<RawEvent>): RawEvent => ({
    happenedAt: DAY1,
    direction: 'outbound',
    outcome: 'answered',
    toNumber: '+17069751509',
    fromNumber: '+14782802726',
    durationSecs: 30,
    ...overrides,
  })

  function getSummary(ev: RawEvent) {
    const result = computeOutreachMatrix('x', [JAMES], [ev])
    return result.days[0].calls[0].displaySummary
  }

  it('uses DB summary (AI-generated) when present', () => {
    expect(getSummary(base({
      transcriptSummary: 'James Baker confirmed he received the letter.',
      transcriptClassification: 'live',
    }))).toBe('James Baker confirmed he received the letter.')
  })

  it('returns disconnected message for disconnected calls', () => {
    expect(getSummary(base({
      transcriptClassification: 'disconnected',
      transcript: 'The number you have reached is not in service.',
    }))).toBe('Number appears disconnected or no longer in service.')
  })

  it('returns voicemail-full message when mailbox is full', () => {
    expect(getSummary(base({
      transcriptClassification: 'voicemail',
      transcript: 'The mailbox is full and cannot accept messages at this time.',
    }))).toContain('mailbox full')
  })

  it('returns message-left summary when transcript mentions leaving a message', () => {
    expect(getSummary(base({
      transcriptClassification: 'voicemail',
      transcript: 'Hi, please leave a message after the beep.',
    }))).toContain('left a callback message')
  })

  it('returns callback message when transcript mentions "trying to reach"', () => {
    expect(getSummary(base({
      transcriptClassification: 'voicemail',
      transcript: "Hi, this is Kathleen. I'm trying to reach James Baker. Please call us back.",
    }))).toContain('callback message')
  })

  it('returns message-left summary when no specific voicemail pattern matches (default: trust employee)', () => {
    expect(getSummary(base({
      transcriptClassification: 'voicemail',
      transcript: 'Voicemail greeting with no standard phrases.',
    }))).toBe('Reached voicemail — left a callback message.')
  })

  it('returns null for live classification with no DB summary (backfill pending)', () => {
    expect(getSummary(base({
      transcriptClassification: 'live',
      transcript: 'Hello, who is this?',
    }))).toBeNull()
  })

  it('returns null when no transcript and no classification', () => {
    expect(getSummary(base({ durationSecs: 30 }))).toBeNull()
  })

  it('DB summary takes priority over derived voicemail logic', () => {
    expect(getSummary(base({
      transcriptSummary: 'Custom AI summary here.',
      transcriptClassification: 'voicemail',
      transcript: 'Please leave a message after the beep.',
    }))).toBe('Custom AI summary here.')
  })
})

// ── classifyVoicemailSubtype ───────────────────────────────────────────────────

describe('classifyVoicemailSubtype', () => {
  it('detects mailbox full — "mailbox is full"', () => {
    expect(classifyVoicemailSubtype('The mailbox is full. Please try again later.')).toBe('voicemail_full')
  })

  it('detects mailbox full — "not accept messages"', () => {
    expect(classifyVoicemailSubtype('This mailbox is full and cannot accept messages at this time.')).toBe('voicemail_full')
  })

  it('detects message left — "leave a message after the beep"', () => {
    expect(classifyVoicemailSubtype('Please leave a message after the beep.')).toBe('voicemail_msg_left')
  })

  it('detects message left — "after the tone"', () => {
    expect(classifyVoicemailSubtype('Please leave your message after the tone.')).toBe('voicemail_msg_left')
  })

  it('detects message left — "at the tone"', () => {
    expect(classifyVoicemailSubtype('At the tone, please record your message.')).toBe('voicemail_msg_left')
  })

  it('detects message left — "record your message"', () => {
    expect(classifyVoicemailSubtype('Please record your message after the beep.')).toBe('voicemail_msg_left')
  })

  it('detects message left — "trying to reach" (Kathleen-drop pattern)', () => {
    expect(classifyVoicemailSubtype(
      "Hi, this is Kathleen. I'm trying to reach James Baker. Please call us back.",
    )).toBe('voicemail_msg_left')
  })

  it('detects message left — "please give us a call"', () => {
    expect(classifyVoicemailSubtype('Please give us a call back at your earliest convenience.')).toBe('voicemail_msg_left')
  })

  it('detects message left — "call us back"', () => {
    expect(classifyVoicemailSubtype('Hi, please call us back when you get a chance.')).toBe('voicemail_msg_left')
  })

  it('detects no message left — "not available"', () => {
    expect(classifyVoicemailSubtype('The person is not available. Please try again later.')).toBe('voicemail_no_msg')
  })

  it('detects no message left — "unable to take"', () => {
    expect(classifyVoicemailSubtype('Unable to take your call at the moment.')).toBe('voicemail_no_msg')
  })

  it('defaults to voicemail_msg_left when no pattern matches', () => {
    // Trust the employee — when we can't tell, assume message was left
    expect(classifyVoicemailSubtype('Generic voicemail text with no recognizable pattern.')).toBe('voicemail_msg_left')
  })

  it('voicemail_full takes priority over message-left signals', () => {
    // Unusual edge: mailbox full message mentions "leave a message" anyway
    expect(classifyVoicemailSubtype(
      'The mailbox is full. You cannot leave a message at this time.',
    )).toBe('voicemail_full')
  })
})

// ── deriveDetailedOutcome ─────────────────────────────────────────────────────

describe('deriveDetailedOutcome', () => {
  const base = (overrides: Partial<RawEvent>): RawEvent => ({
    happenedAt: DAY1,
    direction: 'outbound',
    outcome: 'answered',
    toNumber: '+17069751509',
    fromNumber: '+14782802726',
    durationSecs: 30,
    ...overrides,
  })

  it('no_answer outcome → no_answer', () => {
    expect(deriveDetailedOutcome(base({ outcome: 'no_answer' }))).toBe('no_answer')
  })

  it('busy outcome → busy', () => {
    expect(deriveDetailedOutcome(base({ outcome: 'busy' }))).toBe('busy')
  })

  it('voicemail outcome with no transcript → voicemail_msg_left (default: trust employee)', () => {
    expect(deriveDetailedOutcome(base({ outcome: 'voicemail', durationSecs: 30 }))).toBe('voicemail_msg_left')
  })

  it('voicemail outcome with full-mailbox transcript → voicemail_full', () => {
    expect(deriveDetailedOutcome(base({
      outcome: 'voicemail',
      transcript: 'The mailbox is full and cannot accept messages at this time.',
      transcriptClassification: 'voicemail',
    }))).toBe('voicemail_full')
  })

  it('voicemail outcome with standard VM transcript → voicemail_msg_left', () => {
    expect(deriveDetailedOutcome(base({
      outcome: 'voicemail',
      transcript: 'Please leave a message after the beep.',
      transcriptClassification: 'voicemail',
    }))).toBe('voicemail_msg_left')
  })

  it('answered + classification live + duration 30s → conversation', () => {
    expect(deriveDetailedOutcome(base({
      transcript: 'Hello, who is this?',
      transcriptClassification: 'live',
      durationSecs: 30,
    }))).toBe('conversation')
  })

  it('answered + classification live + duration 8s → conversation (8s is the minimum threshold)', () => {
    expect(deriveDetailedOutcome(base({
      transcript: 'Hello, yes.',
      transcriptClassification: 'live',
      durationSecs: 8,
    }))).toBe('conversation')
  })

  it('answered + classification live + duration 7s → brief_answered (VM greeting misclassified as live)', () => {
    // Whisper sometimes drops negation prefixes — "unable to take your call" becomes
    // "able to take your call" — making the classifier see live speech. Duration gate catches this.
    expect(deriveDetailedOutcome(base({
      transcript: 'Able to take your call at the moment.',
      transcriptClassification: 'live',
      durationSecs: 7,
    }))).toBe('brief_answered')
  })

  it('answered + classification live + duration 5s → brief_answered', () => {
    expect(deriveDetailedOutcome(base({
      transcript: 'Hello?',
      transcriptClassification: 'live',
      durationSecs: 5,
    }))).toBe('brief_answered')
  })

  it('answered + classification disconnected → dead_line', () => {
    expect(deriveDetailedOutcome(base({
      transcript: 'The number you have reached is not in service.',
      transcriptClassification: 'disconnected',
    }))).toBe('dead_line')
  })

  it('answered + classification voicemail + full mailbox transcript → voicemail_full', () => {
    expect(deriveDetailedOutcome(base({
      transcript: 'The mailbox is full.',
      transcriptClassification: 'voicemail',
    }))).toBe('voicemail_full')
  })

  it('answered + classification voicemail + standard transcript → voicemail_msg_left', () => {
    expect(deriveDetailedOutcome(base({
      transcript: 'Please leave a message after the beep.',
      transcriptClassification: 'voicemail',
    }))).toBe('voicemail_msg_left')
  })

  it('answered + no transcript + durationSecs < 4 → brief_answered', () => {
    expect(deriveDetailedOutcome(base({ durationSecs: 3 }))).toBe('brief_answered')
  })

  it('answered + no transcript + durationSecs 0 → brief_answered', () => {
    expect(deriveDetailedOutcome(base({ durationSecs: 0 }))).toBe('brief_answered')
  })

  it('answered + no transcript + hasRecording false → recording_unavailable', () => {
    expect(deriveDetailedOutcome(base({ durationSecs: 30, hasRecording: false }))).toBe('recording_unavailable')
  })

  it('answered + no transcript + hasRecording true → pending_transcript', () => {
    expect(deriveDetailedOutcome(base({ durationSecs: 30, hasRecording: true }))).toBe('pending_transcript')
  })

  it('answered + no transcript + hasRecording undefined (legacy) → pending_transcript', () => {
    expect(deriveDetailedOutcome(base({ durationSecs: 30 }))).toBe('pending_transcript')
  })

  it('answered + unknown classification + durationSecs < 4 → brief_answered', () => {
    expect(deriveDetailedOutcome(base({
      transcript: '...',
      transcriptClassification: 'unknown',
      durationSecs: 2,
    }))).toBe('brief_answered')
  })

  it('answered + unknown classification + durationSecs >= 4 → pending_transcript', () => {
    expect(deriveDetailedOutcome(base({
      transcript: '...',
      transcriptClassification: 'unknown',
      durationSecs: 30,
    }))).toBe('pending_transcript')
  })
})

// ── Day-level counts (conversationCount, voicemailCount, deadLineCount) ────────

describe('computeOutreachMatrix — day counts', () => {
  it('conversationCount = 0 when no call has a live transcript', () => {
    // All EVENTS in the main fixture have no transcripts — pending_transcript or no_answer/voicemail
    const matrix = computeOutreachMatrix('321285583585', [JAMES, LATOSHA], EVENTS)
    expect(matrix.days[0].conversationCount).toBe(0)
    expect(matrix.days[1].conversationCount).toBe(0)
  })

  it('conversationCount increments for each call classified as live', () => {
    const events: RawEvent[] = [
      {
        happenedAt: DAY1, direction: 'outbound', outcome: 'answered', toNumber: '+17069751509',
        fromNumber: '+14782802726', durationSecs: 60,
        transcript: 'Hello, this is James.', transcriptClassification: 'live',
      },
      {
        happenedAt: DAY1, direction: 'outbound', outcome: 'answered', toNumber: '+19123143349',
        fromNumber: '+14782802726', durationSecs: 45,
        transcript: 'Hi there!', transcriptClassification: 'live',
      },
    ]
    const matrix = computeOutreachMatrix('x', [JAMES, LATOSHA], events)
    expect(matrix.days[0].conversationCount).toBe(2)
  })

  it('voicemailCount counts all voicemail subtypes', () => {
    const events: RawEvent[] = [
      // voicemail_msg_left
      {
        happenedAt: DAY1, direction: 'outbound', outcome: 'voicemail', toNumber: '+17069751509',
        fromNumber: '+14782802726', durationSecs: 32,
        transcript: 'Please leave a message after the beep.', transcriptClassification: 'voicemail',
      },
      // voicemail_full
      {
        happenedAt: DAY1, direction: 'outbound', outcome: 'voicemail', toNumber: '+19123143349',
        fromNumber: '+14782802726', durationSecs: 15,
        transcript: 'The mailbox is full.', transcriptClassification: 'voicemail',
      },
    ]
    const matrix = computeOutreachMatrix('x', [JAMES, LATOSHA], events)
    expect(matrix.days[0].voicemailCount).toBe(2)
  })

  it('deadLineCount increments for dead_line calls', () => {
    const events: RawEvent[] = [
      {
        happenedAt: DAY1, direction: 'outbound', outcome: 'answered', toNumber: '+17069751509',
        fromNumber: '+14782802726', durationSecs: 10,
        transcript: 'The number you have reached is not in service.', transcriptClassification: 'disconnected',
      },
    ]
    const matrix = computeOutreachMatrix('x', [JAMES], events)
    expect(matrix.days[0].deadLineCount).toBe(1)
  })

  it('no_answer and busy calls do not affect voicemail or conversation counts', () => {
    const events: RawEvent[] = [
      { happenedAt: DAY1, direction: 'outbound', outcome: 'no_answer', toNumber: '+17069751509', fromNumber: '+14782802726', durationSecs: 0 },
      { happenedAt: DAY1, direction: 'outbound', outcome: 'busy', toNumber: '+17066685460', fromNumber: '+14782802726', durationSecs: 0 },
    ]
    const matrix = computeOutreachMatrix('x', [JAMES], events)
    expect(matrix.days[0].conversationCount).toBe(0)
    expect(matrix.days[0].voicemailCount).toBe(0)
    expect(matrix.days[0].deadLineCount).toBe(0)
  })

  it('detailedOutcome is set on each SessionCall', () => {
    const events: RawEvent[] = [
      {
        happenedAt: DAY1, direction: 'outbound', outcome: 'answered', toNumber: '+17069751509',
        fromNumber: '+14782802726', durationSecs: 60,
        transcript: 'Hello, how can I help you?', transcriptClassification: 'live',
      },
    ]
    const matrix = computeOutreachMatrix('x', [JAMES], events)
    expect(matrix.days[0].calls[0].detailedOutcome).toBe('conversation')
  })
})
