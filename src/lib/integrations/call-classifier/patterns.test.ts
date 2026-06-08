import { describe, it, expect } from 'vitest'
import { classifyTranscript } from './patterns'

// ── Voicemail patterns ────────────────────────────────────────────────────────

describe('classifyTranscript — voicemail', () => {
  const cases = [
    'Please leave your message after the beep.',
    'Please leave a message after the tone.',
    "Hi, you've reached James. I'm not available right now. Please leave a message.",
    "You've reached the voicemail of Sarah Johnson. Please leave a message after the beep.",
    "I'm not able to take your call right now. Leave a message and I'll get back to you.",
    'Your call has been forwarded to an automated voice messaging system.',
    'The mailbox is full. Please try again later.',
    "Hi, I'm not in right now. Please leave a message after the tone.",
    'This mailbox is full and cannot accept messages at this time.',
    'Press 1 to leave a message. Press 2 to send a numeric page.',
    "Sorry I missed your call. Leave a message and I'll call you back.",
  ]

  for (const text of cases) {
    it(`detects voicemail: "${text.slice(0, 60)}..."`, () => {
      expect(classifyTranscript(text)).toBe('voicemail')
    })
  }
})

// ── Disconnected / not in service patterns ────────────────────────────────────

describe('classifyTranscript — disconnected', () => {
  const cases = [
    'The number you have reached is not in service.',
    'The number you have dialed has been disconnected or is no longer in service.',
    'We are sorry. The number you have reached is no longer in service.',
    'This number has been disconnected. Please check the number and try again.',
    "We're sorry. The call cannot be completed as dialed. Please check the number and try again.",
    'This is a recording. The number you dialed is not a working number.',
    'The number you are trying to reach is temporarily out of service.',
    'This number is no longer in service. No further information is available.',
    "We're sorry, your call cannot go through. The number has been disconnected.",
  ]

  for (const text of cases) {
    it(`detects disconnected: "${text.slice(0, 60)}..."`, () => {
      expect(classifyTranscript(text)).toBe('disconnected')
    })
  }
})

// ── Live call patterns ────────────────────────────────────────────────────────

describe('classifyTranscript — live', () => {
  const cases = [
    'Hello?',
    'Hello, who is this?',
    "Yes, I'm calling about the property.",
    'Yeah, I already talked to someone about this.',
    "I'm not interested, please don't call me again.",
    'Hold on, let me get my husband.',
    "I'm sorry, I think you have the wrong number.",
    "Can you call me back? I'm in the middle of something.",
    'What is this regarding?',
    // Note: Kathleen-only monologue ("trying to reach you... please call us back") now correctly
    // classifies as 'voicemail' via the Kathleen-drop pattern below. Tested there instead.
  ]

  for (const text of cases) {
    it(`detects live: "${text.slice(0, 60)}..."`, () => {
      expect(classifyTranscript(text)).toBe('live')
    })
  }
})

// ── Kathleen voicemail-drop patterns (fast-answer VM, greeting not captured) ──

describe('classifyTranscript — kathleen voicemail drop', () => {
  it('detects fast-answer voicemail when Kathleen says "trying to reach"', () => {
    const text =
      "Hello, hi, this is Kathleen with Horizon Recovery Group. I'm trying to reach " +
      "Mr. James Baker regarding a property matter in Troop County. If I reach the right " +
      "phone number, please give us a call back at 478-280-2726."
    expect(classifyTranscript(text)).toBe('voicemail')
  })

  it('detects fast-answer voicemail when Kathleen asks for a callback', () => {
    const text =
      "Hi, this is Kathleen calling about unclaimed funds related to your property. " +
      "Please call us back at your earliest convenience. Thank you."
    expect(classifyTranscript(text)).toBe('voicemail')
  })

  it('detects fast-answer voicemail when Kathleen says "please give us a call"', () => {
    const text =
      "Hi, this is Kathleen from Horizon Recovery. Please give us a call at 478-280-2726. Thanks."
    expect(classifyTranscript(text)).toBe('voicemail')
  })
})

// ── Additional voicemail patterns ──────────────────────────────────────────────

describe('classifyTranscript — additional voicemail patterns', () => {
  it('detects "unable to take your call"', () => {
    expect(classifyTranscript('Unable to take your call at the moment.')).toBe('voicemail')
  })

  it('detects "at the tone, please record your message"', () => {
    expect(classifyTranscript('At the tone, please record your message.')).toBe('voicemail')
  })

  it('detects "has been forwarded to voicemail"', () => {
    expect(classifyTranscript('Has been forwarded to voicemail. The person is not available.')).toBe('voicemail')
  })
})

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe('classifyTranscript — edge cases', () => {
  it('returns unknown for empty transcript', () => {
    expect(classifyTranscript('')).toBe('unknown')
  })

  it('returns unknown for transcript that is only whitespace', () => {
    expect(classifyTranscript('   \n  ')).toBe('unknown')
  })

  it('classification checks only first 300 chars — voicemail greeting at start wins even if live text follows', () => {
    const text =
      "Please leave a message after the beep. " +
      "Hi, this is Kathleen calling about your unclaimed funds. " +
      "We have some important information for you. Please give us a call back at your convenience. " +
      "Thank you so much and have a wonderful day. Looking forward to speaking with you."
    expect(classifyTranscript(text)).toBe('voicemail')
  })

  it('disconnected takes priority over voicemail when both patterns appear', () => {
    // Carrier message that mentions both (unusual but possible)
    const text = 'The number you have dialed is not in service. Please leave a message for an alternative contact.'
    expect(classifyTranscript(text)).toBe('disconnected')
  })

  it('is case-insensitive', () => {
    expect(classifyTranscript('PLEASE LEAVE YOUR MESSAGE AFTER THE BEEP')).toBe('voicemail')
    expect(classifyTranscript('THE NUMBER YOU HAVE REACHED IS NOT IN SERVICE')).toBe('disconnected')
  })
})
