import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { enqueueRequest, listRecentDossiersWithCost, listRequests, getProgressForRequests, getCostTrend } from '@/lib/db/research'
import type { PersonQuery, Goal } from '@/lib/research/types'

const GOALS: Goal[] = ['locate_owner', 'find_heirs', 'mailing_address', 'contact']

// POST → enqueue a research request (returns instantly; Hermes drains the queue). Session or agent.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  let body: Partial<PersonQuery> & { goal?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const goal: Goal = GOALS.includes(body.goal as Goal) ? (body.goal as Goal) : 'find_heirs'
  const query: PersonQuery = {
    name: body.name.trim(),
    address: body.address?.trim() || undefined,
    city: body.city?.trim() || undefined,
    state: body.state?.trim() || 'GA',
    parcelId: body.parcelId?.trim() || undefined,
    county: body.county?.trim() || undefined,
    ageHint: typeof body.ageHint === 'number' ? body.ageHint : undefined,
    relativesHint: Array.isArray(body.relativesHint) ? body.relativesHint.filter(r => typeof r === 'string') : undefined,
    goal,
    caseId: body.caseId ?? null,
  }
  const request = await enqueueRequest({ query, goal, enqueuedBy: 'dashboard' })
  return NextResponse.json({ requestId: request.id, status: request.status })
}

// GET → recent dossiers, queue state (with live progress for active requests), and the cost trend.
export async function GET() {
  if (!(await isAuthenticated())) return unauthorizedResponse()
  const [dossiers, requests, costTrend] = await Promise.all([listRecentDossiersWithCost(25), listRequests(25), getCostTrend(60)])
  const activeIds = requests.filter(r => r.status === 'running' || r.status === 'pending').map(r => r.id)
  const progress = await getProgressForRequests(activeIds)
  return NextResponse.json({ dossiers, requests, progress, costTrend })
}
