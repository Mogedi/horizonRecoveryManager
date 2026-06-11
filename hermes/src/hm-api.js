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
