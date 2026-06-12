// Skill: email-assistant — read Mo's mail: his sent style + recent inbox (with triaged importance).
import { getSentEmails, getRecentEmails } from '../cases-read.js'

export default {
  name: 'email-assistant',
  description: "Mo's email: read recent inbox (with importance triage) for \"what's going on with my emails today/this week\", and read his SENT mail to study his writing voice.",
  playbook:
    'For "what\'s going on with my emails" use recent_emails (days=1 today, 7 this week); each carries an ' +
    'importance (notify=needs attention, digest=FYI, noise) — lead with the notify ones. For style/tone or ' +
    'drafting in Mo\'s voice, use get_sent_emails and mirror his phrasing, length, and sign-off from real ' +
    'examples — never invent a generic style.',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'recent_emails',
      description: "Mo's recently RECEIVED emails with triaged importance (notify/digest/noise). Use for 'what's going on with my emails today/this week'.",
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'how many days back (1 = today, 7 = past week; default 1)' },
          importance: { type: 'string', enum: ['notify', 'digest', 'noise'], description: 'optional filter' },
        },
      },
    },
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
    recent_emails: async (input) => {
      const days = Math.min(Math.max(Number(input.days) || 1, 1), 30)
      const rows = await getRecentEmails({ days, importance: input.importance ?? null, limit: 150 })
      return rows.length
        ? rows.map((r) => ({ date: r.ts, from: r.from_addr, subject: r.subject, importance: r.importance ?? 'unclassified', has_body: r.has_body }))
        : `no received emails in the last ${days} day(s)`
    },
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
