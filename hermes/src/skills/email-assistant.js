// Skill: email-assistant — read Mo's sent mail to study his voice (and, later, draft in it).
// Stub for now (read-only); grows toward thread search + voice-matched drafting.
import { getSentEmails } from '../cases-read.js'

export default {
  name: 'email-assistant',
  description: "Read the emails Mo has SENT — study his writing style/tone, or see how he phrases things (e.g. to draft in his voice).",
  playbook:
    'Use get_sent_emails to ground any style/tone question or draft in Mo\'s actual voice. Never claim you lack email access. ' +
    'When asked to draft, mirror his phrasing, length, and sign-off from real examples — do not invent a generic style.',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'get_sent_emails',
      description:
        "Emails Mo SENT (his own outbound mail, full text). Use to infer his writing style/tone or see how he phrases things. Returns date, subject, recipient, body.",
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'how many recent sent emails (default 20, max 40)' } },
      },
    },
  ],
  handlers: {
    get_sent_emails: async (input) => {
      const lim = Math.min(Math.max(Number(input.limit) || 20, 1), 40)
      const rows = await getSentEmails(lim)
      return rows.length
        ? rows.map((r) => ({
            date: r.ts, subject: r.subject, to: r.recipient,
            body: (r.body || '').replace(/\s+/g, ' ').trim(),
          }))
        : 'no sent emails with full body stored yet'
    },
  },
}
