import { NextRequest, NextResponse } from 'next/server'
import { areAgentWritesEnabled } from '@/lib/db/settings'

// Phase 1 (Hermes): shared helpers for agent write endpoints — the kill switch, the request
// metadata captured into the audit log, and the correlation/idempotency headers Hermes sends.

export type RequestMeta = {
  ip: string | null
  userAgent: string | null
  requestId: string | null
}

export function extractRequestMeta(req: NextRequest): RequestMeta {
  const h = req.headers
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent'),
    requestId: h.get('x-request-id') ?? h.get('x-vercel-id') ?? null,
  }
}

// Ties together every write in one Hermes workflow run (review → analysis → task → snooze).
export function getCorrelationId(req: NextRequest): string | null {
  return req.headers.get('x-correlation-id')
}

// Hermes sends this on every write so retries dedup instead of duplicating rows.
export function getIdempotencyKey(req: NextRequest): string | null {
  return req.headers.get('idempotency-key')
}

// Kill switch — true when agent writes are permitted right now.
export async function assertAgentWritesEnabled(): Promise<boolean> {
  return areAgentWritesEnabled()
}

// 423 Locked — returned to the agent when the kill switch is off. Reads are never affected.
export function agentWritesDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Agent writes are disabled (maintenance mode)' },
    { status: 423 }
  )
}
