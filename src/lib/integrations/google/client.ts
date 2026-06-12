// Google Workspace API client — Gmail and Drive.
// All calls flow through googleLimiter (rate limiting + 429/503 retry).
// 401 token refresh is handled inline: one auto-refresh per request, then throw.

import { GoogleError } from '@/lib/errors'
import { log } from '@/lib/logger'
import { googleLimiter } from '@/lib/rate-limiters'
import { getAccessToken, clearTokenCache } from './auth'

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

// ─── Calendar / Tasks ───────────────────────────────────────────────────────
export type CalendarEventTime = { dateTime?: string; date?: string; timeZone?: string }
export type CalendarEvent = {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  hangoutLink?: string
  start?: CalendarEventTime
  end?: CalendarEventTime
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; organizer?: boolean }>
  organizer?: { email?: string; displayName?: string; self?: boolean }
  creator?: { email?: string; displayName?: string; self?: boolean }
  recurringEventId?: string
  conferenceData?: {
    conferenceId?: string
    entryPoints?: Array<{ entryPointType?: string; uri?: string; label?: string; meetingCode?: string }>
  }
}

// Input for creating/updating an event.
export type CalendarEventInput = {
  summary?: string
  description?: string
  location?: string
  start?: CalendarEventTime
  end?: CalendarEventTime
  attendees?: Array<{ email: string }>
}

export type GoogleTaskList = { id: string; title: string }
export type GoogleTask = {
  id: string
  title?: string
  notes?: string
  status?: 'needsAction' | 'completed'
  due?: string
  completed?: string
  updated?: string
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class GoogleClient {
  // Wraps fetch with one automatic 401 token-refresh. Returns the response as-is
  // after the refresh attempt so callers can check the final status.
  private async fetchWithAuth(url: string, opts: RequestInit = {}): Promise<Response> {
    const token = await getAccessToken()
    const res = await fetch(url, {
      ...opts,
      headers: { ...opts.headers, Authorization: `Bearer ${token}` },
    })
    if (res.status !== 401) return res

    clearTokenCache()
    const freshToken = await getAccessToken()
    return fetch(url, {
      ...opts,
      headers: { ...opts.headers, Authorization: `Bearer ${freshToken}` },
    })
  }

  private async request<T>(
    service: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    params?: Record<string, string | string[]>,
    body?: unknown,
  ): Promise<T> {
    return googleLimiter.schedule(async () => {
      // Build the query string supporting repeated keys (e.g. Gmail's metadataHeaders,
      // which the API expects as one param per header — NOT a comma-joined value).
      let fullUrl = url
      if (params) {
        const sp = new URLSearchParams()
        for (const [k, v] of Object.entries(params)) {
          if (Array.isArray(v)) for (const item of v) sp.append(k, item)
          else sp.append(k, v)
        }
        fullUrl = `${url}?${sp.toString()}`
      }
      const start = Date.now()

      const res = await this.fetchWithAuth(fullUrl, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })

      log.info('google api call', { service, method, url, status: res.status, ms: Date.now() - start })

      if (res.status === 401) throw new GoogleError('Google authentication failed — refresh token may be expired', 401)
      if (res.status === 429 || res.status === 503) throw new GoogleError('Rate limited', res.status)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new GoogleError(`Google ${service} error ${res.status}`, res.status, text)
      }

      // DELETE (and some PATCH) return 204 No Content — don't try to parse an empty body.
      if (res.status === 204) return undefined as T
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    })
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
    const params: Record<string, string | string[]> = { format }
    if (format === 'metadata') {
      // Repeated query param — one entry per header. A comma-joined string is read by
      // the Gmail API as a single (non-existent) header name and returns NO headers.
      params.metadataHeaders = ['From', 'To', 'Cc', 'Subject', 'Date']
    }
    return this.request<GmailMessage>(
      'gmail', 'GET',
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
      params
    )
  }

  // ─── Gmail drafts (compose scope) ────────────────────────────────────────────

  async createDraft(raw: string, threadId?: string): Promise<{ id: string; message?: { id: string; threadId: string } }> {
    return this.request('gmail', 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', undefined,
      { message: { raw, ...(threadId ? { threadId } : {}) } })
  }
  async updateDraft(draftId: string, raw: string, threadId?: string): Promise<{ id: string; message?: { id: string; threadId: string } }> {
    return this.request('gmail', 'PUT', `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, undefined,
      { message: { raw, ...(threadId ? { threadId } : {}) } })
  }
  async sendDraft(draftId: string): Promise<{ id: string; threadId?: string }> {
    return this.request('gmail', 'POST', `https://gmail.googleapis.com/gmail/v1/users/me/drafts/send`, undefined, { id: draftId })
  }
  async deleteDraft(draftId: string): Promise<void> {
    await this.request('gmail', 'DELETE', `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`)
  }
  // Original message headers (Message-Id / References / Subject) for proper reply threading.
  async getMessageHeaders(id: string): Promise<GmailMessage> {
    return this.request<GmailMessage>('gmail', 'GET',
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
      { format: 'metadata', metadataHeaders: ['Message-Id', 'References', 'Subject', 'From', 'To', 'Cc'] })
  }

  // ─── Calendar (events scope) ────────────────────────────────────────────────

  async listCalendarEvents(
    opts: { timeMin?: string; timeMax?: string; maxResults?: number; q?: string } = {}
  ): Promise<CalendarEvent[]> {
    const params: Record<string, string> = {
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(opts.maxResults ?? 20),
      timeMin: opts.timeMin ?? new Date().toISOString(),
    }
    if (opts.timeMax) params.timeMax = opts.timeMax
    if (opts.q) params.q = opts.q
    const res = await this.request<{ items?: CalendarEvent[] }>(
      'calendar', 'GET',
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      params
    )
    return res.items ?? []
  }

  async getCalendarEvent(eventId: string): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(
      'calendar', 'GET',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
    )
  }

  async insertCalendarEvent(event: CalendarEventInput, opts: { sendUpdates?: 'all' | 'none' } = {}): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(
      'calendar', 'POST',
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      { sendUpdates: opts.sendUpdates ?? 'all' },
      event
    )
  }

  async patchCalendarEvent(eventId: string, patch: CalendarEventInput, opts: { sendUpdates?: 'all' | 'none' } = {}): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(
      'calendar', 'PATCH',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { sendUpdates: opts.sendUpdates ?? 'all' },
      patch
    )
  }

  async deleteCalendarEvent(eventId: string, opts: { sendUpdates?: 'all' | 'none' } = {}): Promise<void> {
    await this.request<void>(
      'calendar', 'DELETE',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { sendUpdates: opts.sendUpdates ?? 'all' }
    )
  }

  // ─── Google Tasks ───────────────────────────────────────────────────────────

  async listTaskLists(): Promise<GoogleTaskList[]> {
    const res = await this.request<{ items?: GoogleTaskList[] }>(
      'tasks', 'GET',
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists'
    )
    return res.items ?? []
  }

  async listTasks(
    tasklistId = '@default',
    opts: { showCompleted?: boolean; maxResults?: number } = {}
  ): Promise<GoogleTask[]> {
    const params: Record<string, string> = { maxResults: String(opts.maxResults ?? 100) }
    if (opts.showCompleted) { params.showCompleted = 'true'; params.showHidden = 'true' }
    const res = await this.request<{ items?: GoogleTask[] }>(
      'tasks', 'GET',
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks`,
      params
    )
    return res.items ?? []
  }

  async getTask(tasklistId: string, taskId: string): Promise<GoogleTask> {
    return this.request<GoogleTask>(
      'tasks', 'GET',
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`
    )
  }

  async insertTask(
    tasklistId: string,
    task: { title: string; notes?: string; due?: string }
  ): Promise<GoogleTask> {
    return this.request<GoogleTask>(
      'tasks', 'POST',
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks`,
      undefined,
      task
    )
  }

  async patchTask(
    tasklistId: string,
    taskId: string,
    patch: Partial<{ title: string; notes: string; due: string; status: 'needsAction' | 'completed' }>
  ): Promise<GoogleTask> {
    return this.request<GoogleTask>(
      'tasks', 'PATCH',
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      patch
    )
  }

  async deleteTask(tasklistId: string, taskId: string): Promise<void> {
    await this.request<void>(
      'tasks', 'DELETE',
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`
    )
  }

  // ─── Drive ─────────────────────────────────────────────────────────────────

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

  async searchByNameInFolder(
    name: string,
    parentFolderId: string,
    mimeType?: string
  ): Promise<DriveFile[]> {
    const escapedName = name.replace(/'/g, "\\'")
    const mimeFilter = mimeType ? ` and mimeType = '${mimeType}'` : ''
    const res = await this.request<DriveListResponse>(
      'drive', 'GET',
      'https://www.googleapis.com/drive/v3/files',
      {
        q: `name = '${escapedName}' and '${parentFolderId}' in parents and trashed = false${mimeFilter}`,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink)',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      }
    )
    return res.files ?? []
  }

  async getFolderMetadata(folderId: string): Promise<{ id: string; name: string; webViewLink?: string } | null> {
    try {
      const res = await this.request<DriveFile>(
        'drive', 'GET',
        `https://www.googleapis.com/drive/v3/files/${folderId}`,
        { fields: 'id,name,mimeType,webViewLink', supportsAllDrives: 'true' }
      )
      return { id: res.id, name: res.name, webViewLink: res.webViewLink }
    } catch {
      return null
    }
  }

  async getDriveFileMetadata(fileId: string): Promise<{ id: string; name: string; mimeType: string; size?: string } | null> {
    try {
      return await this.request<{ id: string; name: string; mimeType: string; size?: string }>(
        'drive', 'GET',
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
        { fields: 'id,name,mimeType,size', supportsAllDrives: 'true' }
      )
    } catch {
      return null
    }
  }

  async getDriveName(driveId: string): Promise<string> {
    const res = await this.request<{ name: string }>(
      'drive', 'GET',
      `https://www.googleapis.com/drive/v3/drives/${driveId}`,
      { fields: 'name' }
    )
    return res.name
  }

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

  // Download a Drive file as a raw Buffer (for local PDF parsing).
  async downloadFileAsBuffer(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
    return googleLimiter.schedule(async () => {
      const start = Date.now()
      const res = await this.fetchWithAuth(url)
      log.info('google api call', { service: 'drive', method: 'GET', url, status: res.status, ms: Date.now() - start })

      if (res.status === 401) throw new GoogleError('Authentication failed', 401)
      if (res.status === 429 || res.status === 503) throw new GoogleError('Rate limited', res.status)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new GoogleError(`Drive download error ${res.status}`, res.status, text)
      }

      const mimeType = res.headers.get('content-type') ?? 'application/octet-stream'
      return { buffer: Buffer.from(await res.arrayBuffer()), mimeType }
    })
  }

  // Export a Google Workspace file (Doc, etc.) as plain text.
  async exportFileAsText(fileId: string): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
    return googleLimiter.schedule(async () => {
      const start = Date.now()
      const res = await this.fetchWithAuth(url)
      log.info('google api call', { service: 'drive', method: 'GET', url, status: res.status, ms: Date.now() - start })

      if (res.status === 401) throw new GoogleError('Authentication failed', 401)
      if (res.status === 429 || res.status === 503) throw new GoogleError('Rate limited', res.status)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new GoogleError(`Drive text export error ${res.status}`, res.status, text)
      }

      return res.text()
    })
  }

  // Download a Drive file as base64 (for native PDFs sent to Claude).
  async downloadFileAsBase64(fileId: string): Promise<{ data: string; mimeType: string }> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
    return googleLimiter.schedule(async () => {
      const start = Date.now()
      const res = await this.fetchWithAuth(url)
      log.info('google api call', { service: 'drive', method: 'GET', url, status: res.status, ms: Date.now() - start })

      if (res.status === 401) throw new GoogleError('Authentication failed', 401)
      if (res.status === 429 || res.status === 503) throw new GoogleError('Rate limited', res.status)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new GoogleError(`Drive download error ${res.status}`, res.status, text)
      }

      const mimeType = res.headers.get('content-type') ?? 'application/octet-stream'
      const data = Buffer.from(await res.arrayBuffer()).toString('base64')
      return { data, mimeType }
    })
  }

  // Export a Google Workspace file (Doc, Sheet, etc.) as PDF.
  async exportFileAsPdf(fileId: string): Promise<{ data: string; mimeType: string }> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`
    return googleLimiter.schedule(async () => {
      const start = Date.now()
      const res = await this.fetchWithAuth(url)
      log.info('google api call', { service: 'drive', method: 'GET', url, status: res.status, ms: Date.now() - start })

      if (res.status === 401) throw new GoogleError('Authentication failed', 401)
      if (res.status === 429 || res.status === 503) throw new GoogleError('Rate limited', res.status)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new GoogleError(`Drive export error ${res.status}`, res.status, text)
      }

      const data = Buffer.from(await res.arrayBuffer()).toString('base64')
      return { data, mimeType: 'application/pdf' }
    })
  }

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
