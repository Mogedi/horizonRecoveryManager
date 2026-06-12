// Skill: draft-email — draft replies/new emails in Mo's voice as Gmail DRAFTS (never sends).
// create_draft makes the Gmail draft and signals the bot to post an interactive review card
// (edit recipients/message, Send-with-confirm). Sending only happens from that card.
import { getEmailDetail } from '../cases-read.js'
import { emailDraftCreate } from '../hm-api.js'
import { STYLE_RULES } from '../style-rules.js'

export default {
  name: 'draft-email',
  description: "Draft an email reply (or a new email) in Mo's voice as a Gmail DRAFT — never sends. Use for \"draft a reply to X\", \"write an email to Y\".",
  playbook:
    'Process: for a REPLY, call read_email_to_reply first to get the original (and understand the thread); ' +
    'pull real style examples with get_sent_emails. Set To = the original sender, CC = the original CC ' +
    'addresses (reply-all) MINUS Mo\'s own address, add Kathleen (kathleen@horizonrecoverygroup.com) to CC if ' +
    'it\'s case-related; Subject = "Re: <original>"; pass reply_to_email_id so it threads. Then call ' +
    'create_draft (it posts a review card — Mo edits recipients/message and clicks Send; you NEVER send).\n\n' +
    STYLE_RULES,
  writes: true,
  defaultEnabled: true,
  tools: [
    {
      name: 'read_email_to_reply',
      description: 'Find a recent RECEIVED email to reply to (by sender or subject). Returns id, from, to, cc, subject, body — so you can thread + reply-all correctly.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'sender name/email or subject fragment' } },
        required: ['query'],
      },
    },
    {
      name: 'create_draft',
      description: 'Create a Gmail DRAFT (never sends). For a reply, pass reply_to_email_id (from read_email_to_reply) to thread it. Provide to/cc/bcc/subject/body. Posts a review card for Mo.',
      input_schema: {
        type: 'object',
        properties: {
          reply_to_email_id: { type: 'string', description: 'original Gmail id for a threaded reply' },
          to: { type: 'array', items: { type: 'string' } },
          cc: { type: 'array', items: { type: 'string' } },
          bcc: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          body: { type: 'string', description: "the email body, in Mo's voice" },
        },
        required: ['body'],
      },
    },
  ],
  handlers: {
    read_email_to_reply: async (input) => {
      const e = await getEmailDetail(String(input.query ?? ''))
      if (!e) return 'no matching received email found — try a different sender/subject'
      return { id: e.id, from: e.from_addr, to: e.to_addr, cc: e.cc_addr, subject: e.subject, body: (e.body || '').slice(0, 3000) }
    },
    create_draft: async (input) => {
      const r = await emailDraftCreate({
        replyToGmailId: input.reply_to_email_id || undefined,
        to: input.to || [], cc: input.cc || [], bcc: input.bcc || [],
        subject: input.subject || '', body: input.body || '',
      })
      return {
        _draftCard: {
          draftId: r.draftId, replyToEmailId: input.reply_to_email_id || null,
          to: r.to, cc: r.cc, bcc: r.bcc, subject: r.subject, body: input.body || '',
        },
        _toolText: `Draft created (id ${r.draftId}). To: ${r.to.join(', ') || '(none)'} · CC: ${r.cc.join(', ') || '(none)'}. Posting the review card for Mo.`,
      }
    },
  },
}
