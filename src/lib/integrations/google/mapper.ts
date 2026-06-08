// Google Workspace → ActivityEventInput mapper.
// This is the only file that interprets raw Gmail API shapes.
// Drive files are returned as-is (no DB storage — on-demand search only).

import type { ActivityEventInput } from '@/lib/db/activity-events'
import { ActivitySource } from '@prisma/client'
import type { GmailMessage, DriveFile } from './client'

function header(msg: GmailMessage, name: string): string | null {
  const headers = msg.payload?.headers ?? []
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null
}

// Gmail message → ActivityEventInput.
// dealHubspotId is resolved by the sync layer (email matching against deal contacts).
// direction: 'outbound' if message has the SENT label, else 'inbound'.
export function mapGmailMessage(
  msg: GmailMessage,
  dealHubspotId: string | null
): ActivityEventInput {
  const sentAt = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date()
  const isSent = (msg.labelIds ?? []).includes('SENT')

  const from = header(msg, 'from') ?? null
  const to = header(msg, 'to') ?? null
  const cc = header(msg, 'cc') ?? null
  const subject = header(msg, 'subject') ?? null

  return {
    dealHubspotId,
    source: ActivitySource.GOOGLE,
    externalId: msg.id,
    type: 'email',
    happenedAt: sentAt,
    direction: isSent ? 'outbound' : 'inbound',
    body: msg.snippet ?? null,
    metadata: JSON.parse(JSON.stringify({
      subject,
      from,
      to,
      cc,
      labelIds: msg.labelIds ?? [],
      threadId: msg.threadId,
    })),
    rawPayload: JSON.parse(JSON.stringify(msg)),
  }
}

// Drive file — no storage, used for on-demand search display.
export type NormalizedDriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedAt: string | null
  createdAt: string | null
  webViewLink: string | null
  iconLink: string | null
  sizeBytes: number | null
}

export function mapDriveFile(file: DriveFile): NormalizedDriveFile {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedTime ?? null,
    createdAt: file.createdTime ?? null,
    webViewLink: file.webViewLink ?? null,
    iconLink: file.iconLink ?? null,
    sizeBytes: file.size ? Number(file.size) : null,
  }
}
