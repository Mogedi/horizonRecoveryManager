import 'server-only'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE } from './session'

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return false
  return verifySessionToken(token)
}

export function isCronRequest(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  return req.headers.get('authorization') === `Bearer ${cronSecret}`
}

// Hermes agent token — scoped separately from CRON_SECRET so it can be revoked independently
// and so agent-originated writes are attributable in the audit log.
export function isAgentRequest(req: NextRequest): boolean {
  const token = process.env.HERMES_TOKEN
  if (!token) return false
  return req.headers.get('authorization') === `Bearer ${token}`
}

// True for a logged-in browser session, a Vercel cron call, or the Hermes agent.
export async function isAuthedOrAgent(req: NextRequest): Promise<boolean> {
  return (await isAuthenticated()) || isCronRequest(req) || isAgentRequest(req)
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
