// Read Google Drive case documents for Hermes. Reuses the doc-verify extraction approach:
// Google-native files export to text; PDFs go through Claude (handles scanned county docs).
import { googleClient } from './client'
import { callClaudeWithDocuments } from '@/lib/ai/client'
import { getDealById } from '@/lib/db/deals'

export type DealDocument = { id: string; name: string; mimeType: string; sizeBytes: number | null; webViewLink: string | null }

type CachedFile = { id: string; name: string; mimeType: string; sizeBytes?: number; webViewLink?: string }

// A deal's indexed Drive files (names + ids), from the DB cache — zero Drive API calls.
export async function listDealDocuments(dealHubspotId: string): Promise<{ folderLink: string | null; documents: DealDocument[] }> {
  const deal = await getDealById(dealHubspotId)
  if (!deal) throw new Error('deal not found')
  const files = (Array.isArray(deal.driveFilesCache) ? deal.driveFilesCache : []) as CachedFile[]
  return {
    folderLink: deal.driveFolderUrl ?? null,
    documents: files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: typeof f.sizeBytes === 'number' ? f.sizeBytes : null,
      webViewLink: f.webViewLink ?? null,
    })),
  }
}

// If the model wrapped the transcription in {"document_text": "..."} (or similar), unwrap it.
function unwrapJson(s: string): string {
  const t = s.trim()
  if (t.startsWith('{') && t.endsWith('}')) {
    try {
      const obj = JSON.parse(t)
      const vals = Object.values(obj)
      if (vals.length === 1 && typeof vals[0] === 'string') return vals[0] as string
    } catch { /* not JSON — return as-is */ }
  }
  return s
}

const GOOGLE_TEXT_MIME = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
])

// Returns the document's text. PDFs are transcribed by Claude (works on scanned docs).
export async function readDriveDocument(fileId: string, maxChars = 12000): Promise<{ name: string; mimeType: string; text: string; truncated: boolean }> {
  const meta = await googleClient.getDriveFileMetadata(fileId)
  if (!meta) throw new Error('file not found')
  const { name, mimeType } = meta

  let text: string
  if (GOOGLE_TEXT_MIME.has(mimeType)) {
    text = await googleClient.exportFileAsText(fileId)
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    text = await googleClient.exportFileAsText(fileId) // exports as plain text
  } else if (mimeType === 'application/pdf') {
    const { data } = await googleClient.downloadFileAsBase64(fileId)
    const raw = await callClaudeWithDocuments(
      [{ data, mimeType: 'application/pdf', label: name }],
      'Transcribe the full text of this document verbatim. Preserve headings and structure. ' +
        'Return the raw text ONLY — do not wrap it in JSON, markdown, quotes, or any commentary.',
      undefined,
      8000
    )
    text = unwrapJson(raw)
  } else if (mimeType.startsWith('text/')) {
    const { buffer } = await googleClient.downloadFileAsBuffer(fileId)
    text = buffer.toString('utf8')
  } else {
    throw new Error(`unsupported file type for text read: ${mimeType}`)
  }

  return { name, mimeType, text: text.slice(0, maxChars), truncated: text.length > maxChars }
}
