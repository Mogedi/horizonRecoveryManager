// Scoped HTTP write client for the HorizonManager agent API.
// Sends Authorization: Bearer $HERMES_TOKEN, plus Idempotency-Key (dedup) and
// X-Correlation-Id (groups one workflow's writes in the audit log) on every call.
import { randomUUID } from 'node:crypto'

function baseUrl() {
  return process.env.HM_BASE_URL || 'http://localhost:3000'
}

function authHeaders(idem, corr) {
  const token = process.env.HERMES_TOKEN
  if (!token) throw new Error('HERMES_TOKEN not set')
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  if (idem) h['idempotency-key'] = idem
  if (corr) h['x-correlation-id'] = corr
  return h
}

async function req(method, path, { body, idem, corr } = {}) {
  const res = await fetch(baseUrl() + path, {
    method,
    headers: authHeaders(idem, corr),
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* 204 No Content */ }
  if (!res.ok) {
    const err = new Error(`HM ${method} ${path} → ${res.status}: ${json?.error ?? res.statusText}`)
    err.status = res.status
    throw err
  }
  return json
}

// Sync triggers — no idempotency/correlation (these aren't case_analyses writes). The dashboard
// sync routes accept HERMES_TOKEN. 'full' = incremental since last sync (per the sync code).
export const syncJustCall = (mode = 'full') => req('POST', '/api/sync/justcall', { body: { mode } })
export const syncGmail = (mode = 'full') => req('POST', '/api/sync/google/gmail', { body: { mode } })
export const syncDrive = () => req('POST', '/api/sync/google/drive', {})
export const triggerLayer1 = () => req('POST', '/api/sync/layer1', {})
export const triggerLayer2 = (dealId) => req('POST', `/api/sync/layer2/${dealId}`, {})
// Combined per-case refresh: HubSpot Layer 2 + this deal's JustCall + this deal's Gmail,
// freshness-gated (skips if refreshed within 30 min unless force).
export const refreshCase = (dealId, force = false) =>
  req('POST', `/api/deals/${encodeURIComponent(dealId)}/refresh${force ? '?force=1' : ''}`, {})

// Heavy nightly/weekly jobs. Each call is one chunk so it stays under the Vercel 60s budget;
// the scheduler loops until `done`.
// Transcribe a chunk of un-transcribed answered calls (Whisper + Claude). Small limit so the
// batch finishes inside 60s (each call ~10s). Returns { processed, failed, remaining, done, classifications }.
export const classifyCalls = (limit = 4) => req('POST', '/api/calls/classify', { body: { limit } })
// Active (non-terminal) deals with a Drive folder — the weekly doc-verify candidate set.
export const activeDealsWithDocs = () => req('GET', '/api/deals/active-with-docs', {})
// Doc verification for one deal (Playwright screenshot + Claude Vision). One per request (~25s).
export const verifyDealDocs = (dealId) => req('POST', `/api/deals/${dealId}/drive/hubspot-check`, { body: {} })
// Morning briefing as plain text (non-streamed) for posting to Discord.
export const getDigest = () => req('POST', '/api/digest', {})

// Incremental email intake + importance triage. Returns { fetched, notify[], digest[], noiseCount }.
export const emailIntake = () => req('POST', '/api/email/intake', {})

// Full attention queue (the dashboard's rules engine output): action buckets
// (follow_up / move_close / call_today / ready_work / snoozed), per-deal flags, stageMap,
// pipelineStats. The single correct source for outreach planning — no rule logic duplicated.
export const getAttentionQueue = () => req('GET', '/api/deals', {})

// Google Calendar + Tasks (read/write — audited + kill-switchable server-side).
const enc = encodeURIComponent
// Calendar
export const getCalendarEvents = (days = 14) => req('GET', `/api/google/calendar?days=${days}`, {})
export const getCalendarEvent = (id) => req('GET', `/api/google/calendar/${enc(id)}`, {})
export const addCalendarEvent = (event) => req('POST', '/api/google/calendar', { body: event })
export const updateCalendarEvent = (id, patch) => req('PATCH', `/api/google/calendar/${enc(id)}`, { body: patch })
export const removeCalendarEvent = (id) => req('DELETE', `/api/google/calendar/${enc(id)}`, {})
// Drive documents (read)
export const getDealDocuments = (dealId) => req('GET', `/api/deals/${enc(dealId)}/documents`, {})
export const readDriveDocument = (fileId) => req('GET', `/api/google/drive/${enc(fileId)}`, {})
// Tasks
export const getGoogleTasks = (completed = false) =>
  req('GET', `/api/google/tasks${completed ? '?completed=1' : ''}`, {})
export const addGoogleTask = (task) => req('POST', '/api/google/tasks', { body: task })
export const completeGoogleTask = (id) => req('PATCH', `/api/google/tasks/${enc(id)}`, {})
export const updateGoogleTask = (id, patch) => req('PATCH', `/api/google/tasks/${enc(id)}`, { body: patch })
export const removeGoogleTask = (id) => req('DELETE', `/api/google/tasks/${enc(id)}`, {})

// One workflow run = one correlationId across all its writes.
export function newWorkflow(correlationId = `hermes:${randomUUID()}`) {
  return {
    correlationId,
    postAnalysis: (dealId, analysis, idem) =>
      req('POST', `/api/deals/${dealId}/analysis`, { body: analysis, idem, corr: correlationId }),
    createTask: (task, idem) => req('POST', `/api/tasks`, { body: task, idem, corr: correlationId }),
    completeTask: (id) => req('PATCH', `/api/tasks/${id}`, { corr: correlationId }),
    deleteTask: (id) => req('DELETE', `/api/tasks/${id}`, { corr: correlationId }),
    snooze: (dealId, body, idem) =>
      req('POST', `/api/deals/${dealId}/snooze`, { body, idem, corr: correlationId }),
    unsnooze: (dealId) => req('DELETE', `/api/deals/${dealId}/snooze`, { corr: correlationId }),
    triggerSummary: (dealId) => req('POST', `/api/deals/${dealId}/summary`, { corr: correlationId }),
  }
}
