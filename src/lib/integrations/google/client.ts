// Google Workspace API client — Gmail and Drive.
// All calls flow through request() which handles token refresh, rate limiting, and retry.

import { GoogleError } from '@/lib/errors'
import { log } from '@/lib/logger'
import { TokenBucket } from '@/lib/utils/rate-limiter'
import { getAccessToken, clearTokenCache } from './auth'

// Google Workspace default quota: 250 req/s. Use 30% cap = 75 req/s.
const rateLimiter = new TokenBucket(75, 75)
const MAX_RETRIES = 3

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

// ─── Raw API response types ───────────────────────────────────────────────────

export type GmailHeader = { name: string; value: string }

export type GmailMessagePart = {
  partId?: string
  mimeType?: string
  headers?: GmailHeader[]
  body?: { data?: string; size?: number }
  parts?: GmailMessagePart[]
}

export type GmailMessage = {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string   // Unix ms as string
  payload?: {
    headers?: GmailHeader[]
    mimeType?: string
    parts?: GmailMessagePart[]
    body?: { data?: string; size?: number }
  }
}

export type GmailListResponse = {
  messages?: { id: string; threadId: string }[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  createdTime?: string
  size?: string
  webViewLink?: string
  webContentLink?: string
  iconLink?: string
  parents?: string[]
}

export type DriveListResponse = {
  files?: DriveFile[]
  nextPageToken?: string
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class GoogleClient {
  private async request<T>(
    service: string,
    method: 'GET' | 'POST',
    url: string,
    params?: Record<string, string>,
    body?: unknown,
    attempt = 0
  ): Promise<T> {
    await rateLimiter.acquire()

    const token = await getAccessToken()
    const fullUrl = params
      ? `${url}?${new URLSearchParams(params)}`
      : url

    const start = Date.now()

    const res = await fetch(fullUrl, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    log.info('google api call', { service, method, url, status: res.status, ms: Date.now() - start })

    if (res.status === 429 || res.status === 503) {
      if (attempt >= MAX_RETRIES) throw new GoogleError('Google rate limit exceeded after retries', res.status)
      const backoffMs = 1000 * Math.pow(2, attempt)
      log.warn('google rate limit — backing off', { backoffMs, attempt })
      await sleep(backoffMs)
      return this.request(service, method, url, params, body, attempt + 1)
    }

    if (res.status === 401 && attempt === 0) {
      clearTokenCache()
      return this.request(service, method, url, params, body, attempt + 1)
    }

    if (res.status === 401) {
      throw new GoogleError('Google authentication failed — refresh token may be expired', 401)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new GoogleError(`Google ${service} error ${res.status}`, res.status, text)
    }

    return res.json() as Promise<T>
  }

  // ─── Gmail ─────────────────────────────────────────────────────────────────

  async listGmailMessages(
    query: string,
    opts: { maxResults?: number; pageToken?: string } = {}
  ): Promise<GmailListResponse> {
    const params: Record<string, string> = { q: query }
    if (opts.maxResults) params.maxResults = String(opts.maxResults)
    if (opts.pageToken) params.pageToken = opts.pageToken

    return this.request<GmailListResponse>(
      'gmail', 'GET',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      params
    )
  }

  async getGmailMessage(
    id: string,
    format: 'metadata' | 'full' | 'minimal' = 'metadata'
  ): Promise<GmailMessage> {
    const params: Record<string, string> = { format }
    if (format === 'metadata') {
      params.metadataHeaders = 'From,To,Cc,Subject,Date'
    }
    return this.request<GmailMessage>(
      'gmail', 'GET',
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
      params
    )
  }

  // ─── Drive ─────────────────────────────────────────────────────────────────

  // List all immediate children of a folder. Paginates until all results are returned.
  async listFolderContents(
    folderId: string,
    opts: { mimeType?: string } = {}
  ): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken: string | undefined

    do {
      const params: Record<string, string> = {
        q: `'${folderId}' in parents and trashed = false${opts.mimeType ? ` and mimeType = '${opts.mimeType}'` : ''}`,
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink,iconLink)',
        pageSize: '100',
        orderBy: 'name',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      }
      if (pageToken) params.pageToken = pageToken

      const res = await this.request<DriveListResponse>(
        'drive', 'GET',
        'https://www.googleapis.com/drive/v3/files',
        params
      )
      files.push(...(res.files ?? []))
      pageToken = res.nextPageToken
    } while (pageToken)

    return files
  }

  // Search for files/folders by name within a specific parent folder.
  // Uses exact name match — caller handles normalization before calling this.
  async searchByNameInFolder(
    name: string,
    parentFolderId: string,
    mimeType?: string
  ): Promise<DriveFile[]> {
    // Escape single quotes in name for Drive query syntax
    const escapedName = name.replace(/'/g, "\\'")
    const mimeFilter = mimeType ? ` and mimeType = '${mimeType}'` : ''
    const params: Record<string, string> = {
      q: `name = '${escapedName}' and '${parentFolderId}' in parents and trashed = false${mimeFilter}`,
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    }
    const res = await this.request<DriveListResponse>(
      'drive', 'GET',
      'https://www.googleapis.com/drive/v3/files',
      params
    )
    return res.files ?? []
  }

  // Get the display name of a shared drive by ID.
  async getDriveName(driveId: string): Promise<string> {
    const res = await this.request<{ name: string }>(
      'drive', 'GET',
      `https://www.googleapis.com/drive/v3/drives/${driveId}`,
      { fields: 'name' }
    )
    return res.name
  }

  // List ALL folders in a shared drive (any depth) in one paginated pass.
  // Returns folders with their parents[] so callers can build full paths.
  async listAllFoldersInDrive(driveId: string): Promise<DriveFile[]> {
    const folders: DriveFile[] = []
    let pageToken: string | undefined

    do {
      const params: Record<string, string> = {
        q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        corpora: 'drive',
        driveId,
        fields: 'nextPageToken,files(id,name,mimeType,webViewLink,parents)',
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      }
      if (pageToken) params.pageToken = pageToken

      const res = await this.request<DriveListResponse>(
        'drive', 'GET',
        'https://www.googleapis.com/drive/v3/files',
        params
      )
      folders.push(...(res.files ?? []))
      pageToken = res.nextPageToken
    } while (pageToken)

    return folders
  }

  // Download a Drive file as a raw Buffer.
  // Used for local PDF text extraction (pdf-parse) — avoids sending binary to Claude.
  async downloadFileAsBuffer(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    await rateLimiter.acquire()
    const token = await getAccessToken()
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`

    const start = Date.now()
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    log.info('google api call', { service: 'drive', method: 'GET', url, status: res.status, ms: Date.now() - start })

    if (res.status === 401) { clearTokenCache(); return this.downloadFileAsBuffer(fileId) }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new GoogleError(`Drive download error ${res.status}`, res.status, text)
    }

    const mimeType = res.headers.get('content-type') ?? 'application/octet-stream'
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, mimeType }
  }

  // Export a Google Workspace file (Doc, etc.) as plain text.
  // Returns the raw text string — far cheaper to pass to Claude than a PDF binary.
  async exportFileAsText(fileId: string): Promise<string> {
    await rateLimiter.acquire()
    const token = await getAccessToken()
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`

    const start = Date.now()
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    log.info('google api call', { service: 'drive', method: 'GET', url, status: res.status, ms: Date.now() - start })

    if (res.status === 401) { clearTokenCache(); return this.exportFileAsText(fileId) }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new GoogleError(`Drive text export error ${res.status}`, res.status, text)
    }

    return res.text()
  }

  // Download a Drive file and return it as base64.
  // For native PDFs only — use exportFileAsPdf() for Google Workspace files.
  async downloadFileAsBase64(fileId: string): Promise<{ data: string; mimeType: string }> {
    await rateLimiter.acquire()
    const token = await getAccessToken()
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`

    const start = Date.now()
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    log.info('google api call', { service: 'drive', method: 'GET', url, status: res.status, ms: Date.now() - start })

    if (res.status === 401) {
      clearTokenCache()
      return this.downloadFileAsBase64(fileId)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new GoogleError(`Drive download error ${res.status}`, res.status, text)
    }

    const mimeType = res.headers.get('content-type') ?? 'application/octet-stream'
    const buffer = await res.arrayBuffer()
    const data = Buffer.from(buffer).toString('base64')
    return { data, mimeType }
  }

  // Export a Google Workspace file (Doc, Sheet, etc.) as PDF.
  // Use this for mimeType starting with "application/vnd.google-apps."
  async exportFileAsPdf(fileId: string): Promise<{ data: string; mimeType: string }> {
    await rateLimiter.acquire()
    const token = await getAccessToken()
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`

    const start = Date.now()
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    log.info('google api call', { service: 'drive', method: 'GET', url, status: res.status, ms: Date.now() - start })

    if (res.status === 401) {
      clearTokenCache()
      return this.exportFileAsPdf(fileId)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new GoogleError(`Drive export error ${res.status}`, res.status, text)
    }

    const buffer = await res.arrayBuffer()
    const data = Buffer.from(buffer).toString('base64')
    return { data, mimeType: 'application/pdf' }
  }

  // Full-text search across all accessible drives (My Drive + Shared Drives).
  // Used as fallback when folder-based lookup fails.
  async searchDriveFiles(
    query: string,
    opts: { maxResults?: number; pageToken?: string; driveId?: string } = {}
  ): Promise<DriveListResponse> {
    const params: Record<string, string> = {
      q: `${query} and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink,iconLink)',
      orderBy: 'modifiedTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    }
    if (opts.maxResults) params.pageSize = String(opts.maxResults)
    if (opts.pageToken) params.pageToken = opts.pageToken
    // Scope search to a specific shared drive when provided
    if (opts.driveId) {
      params.corpora = 'drive'
      params.driveId = opts.driveId
    }

    return this.request<DriveListResponse>(
      'drive', 'GET',
      'https://www.googleapis.com/drive/v3/files',
      params
    )
  }
}

export const googleClient = new GoogleClient()
