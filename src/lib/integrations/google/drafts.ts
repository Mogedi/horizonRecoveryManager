// Gmail draft assistant (compose scope). Builds RFC822 MIME, creates/updates Gmail DRAFTS, and
// sends them only on explicit request. Replies are properly threaded (In-Reply-To / References /
// threadId) by reading the original message's headers.
import { googleClient } from './client'

export type DraftInput = {
  draftId?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  body?: string
  replyToGmailId?: string // original Gmail message id, for a threaded reply
}

export type DraftResult = {
  draftId: string
  messageId: string | null
  threadId: string | null
  to: string[]; cc: string[]; bcc: string[]; subject: string
}

function header(name: string, value: string) {
  return `${name}: ${value}`
}

function buildMime(opts: {
  to: string[]; cc: string[]; bcc: string[]; subject: string; body: string
  inReplyTo?: string | null; references?: string | null
}): string {
  const lines: string[] = []
  if (opts.to.length) lines.push(header('To', opts.to.join(', ')))
  if (opts.cc.length) lines.push(header('Cc', opts.cc.join(', ')))
  if (opts.bcc.length) lines.push(header('Bcc', opts.bcc.join(', ')))
  lines.push(header('Subject', opts.subject))
  if (opts.inReplyTo) lines.push(header('In-Reply-To', opts.inReplyTo))
  if (opts.references) lines.push(header('References', opts.references))
  lines.push(header('Content-Type', 'text/plain; charset="UTF-8"'))
  lines.push(header('MIME-Version', '1.0'))
  const mime = lines.join('\r\n') + '\r\n\r\n' + (opts.body ?? '')
  return Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function findHeader(msg: { payload?: { headers?: { name: string; value: string }[] } }, name: string): string | null {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null
}

export async function createOrUpdateDraft(input: DraftInput): Promise<DraftResult> {
  const to = (input.to ?? []).filter(Boolean)
  const cc = (input.cc ?? []).filter(Boolean)
  const bcc = (input.bcc ?? []).filter(Boolean)
  const subject = input.subject ?? ''

  let inReplyTo: string | null = null
  let references: string | null = null
  let threadId: string | undefined
  if (input.replyToGmailId) {
    const orig = await googleClient.getMessageHeaders(input.replyToGmailId)
    const msgId = findHeader(orig, 'message-id')
    inReplyTo = msgId
    references = [findHeader(orig, 'references'), msgId].filter(Boolean).join(' ') || null
    threadId = orig.threadId
  }

  const raw = buildMime({ to, cc, bcc, subject, body: input.body ?? '', inReplyTo, references })
  const res = input.draftId
    ? await googleClient.updateDraft(input.draftId, raw, threadId)
    : await googleClient.createDraft(raw, threadId)

  return {
    draftId: res.id,
    messageId: res.message?.id ?? null,
    threadId: res.message?.threadId ?? threadId ?? null,
    to, cc, bcc, subject,
  }
}

export async function sendDraft(draftId: string): Promise<{ id: string; threadId: string | null }> {
  const r = await googleClient.sendDraft(draftId)
  return { id: r.id, threadId: r.threadId ?? null }
}

export async function discardDraft(draftId: string): Promise<void> {
  await googleClient.deleteDraft(draftId)
}
