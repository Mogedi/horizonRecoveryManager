// Skill: email-assistant — read Mo's mail: his sent style + recent inbox (with triaged importance),
// and curate his living email STYLE SHEET (do/don't rules used when drafting).
import { getSentEmails, getRecentEmails } from '../cases-read.js'
import { listStyle, addStyle, removeStyle } from '../email-style.js'

export default {
  name: 'email-assistant',
  description: "Mo's email: read recent inbox (with importance triage), read his SENT mail to study his voice, and manage his email STYLE SHEET (do/don't rules).",
  playbook:
    'For "what\'s going on with my emails" use recent_emails (days=1 today, 7 this week); each carries an ' +
    'importance (notify=needs attention, digest=FYI, noise) — lead with the notify ones. For style/tone, use ' +
    'get_sent_emails and mirror his real phrasing. STYLE SHEET: "show my email style" → view_email_style; ' +
    '"add to my email style / I do (not) do X" → add_email_style (kind do|dont); "drop that rule" → ' +
    'remove_email_style by id. When Mo corrects a draft in a way that reflects a durable preference, OFFER to ' +
    'add it to the style sheet.',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'view_email_style',
      description: "Show Mo's email style sheet (the do/don't rules used when drafting), with ids.",
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'add_email_style',
      description: "Add a rule to Mo's email style sheet. kind: 'do' or 'dont'.",
      input_schema: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['do', 'dont'] }, rule: { type: 'string' } },
        required: ['kind', 'rule'],
      },
    },
    {
      name: 'remove_email_style',
      description: 'Remove a style-sheet rule by its id (from view_email_style).',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
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
    view_email_style: async () => {
      const s = await listStyle()
      return { do: s.do.map((x) => ({ id: x.id, rule: x.text })), dont: s.dont.map((x) => ({ id: x.id, rule: x.text })) }
    },
    add_email_style: async (input) => {
      if (!input.rule) return 'a rule is required'
      const e = await addStyle(input.kind === 'dont' ? 'dont' : 'do', input.rule)
      return { added: { id: e.id, kind: input.kind === 'dont' ? 'dont' : 'do', rule: e.text } }
    },
    remove_email_style: async (input) => {
      if (!input.id) return 'an id is required (from view_email_style)'
      return (await removeStyle(input.id)) ? { removed: input.id } : `no style rule with id ${input.id}`
    },
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
