export type CallClassification = 'live' | 'voicemail' | 'disconnected' | 'unknown'

// Only inspect the first 300 chars of the transcript. Voicemail greetings are
// short and always lead the recording. Beyond 300 chars we risk matching words
// Kathleen says in her own leave-a-message after the greeting.
const WINDOW = 300

const DISCONNECTED_PATTERNS = [
  /not in service/i,
  /no longer in service/i,
  /has been disconnected/i,
  /been disconnected/i,
  /not a working number/i,
  /check the number/i,
  /cannot be completed as dialed/i,
  /cannot go through/i,
  /temporarily out of service/i,
  /number you (have |are trying to )?(reach|dial)/i,  // "number you have reached", "number you dialed"
]

const VOICEMAIL_PATTERNS = [
  /leave (a |your )?message/i,
  /after the (beep|tone)/i,
  /not (available|able to take your call|in right now)/i,
  /unable to (take|answer)/i,
  /forwarded to (an )?automated voice/i,
  /voice\s?mail/i,
  /mail\s?box/i,
  /missed your call/i,
  /sorry i missed/i,
  /press \d+ to leave/i,
  /record your message/i,
  /hang up or press/i,
  /at the tone/i,
]

// Outbound call from Kathleen with no pickup — voicemail answered so fast the
// greeting wasn't captured by JustCall. Kathleen's message starts immediately.
// Signal: one-sided monologue including "trying to reach" or "please call me back."
const KATHLEEN_VOICEMAIL_DROP_PATTERNS = [
  /trying to (get in contact|reach|contact)/i,
  /please (give us a call|call (me|us) back|return (my|our) call)/i,
  /leave (me|us) a (message|callback)/i,
]

export function classifyTranscript(text: string): CallClassification {
  const trimmed = text.trim()
  if (!trimmed) return 'unknown'

  const window = trimmed.slice(0, WINDOW)

  // Disconnected takes priority — carrier messages sometimes contain voicemail-adjacent words
  for (const pattern of DISCONNECTED_PATTERNS) {
    if (pattern.test(window)) return 'disconnected'
  }

  for (const pattern of VOICEMAIL_PATTERNS) {
    if (pattern.test(window)) return 'voicemail'
  }

  // Fast-answer voicemail: greeting not captured, but Kathleen's outreach monologue is present
  for (const pattern of KATHLEEN_VOICEMAIL_DROP_PATTERNS) {
    if (pattern.test(trimmed)) return 'voicemail'
  }

  return 'live'
}
