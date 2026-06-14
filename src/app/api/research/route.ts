import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { enqueueRequest, findRecentDossierForCase, findRecentPropertyEvidenceForCase, listRecentDossiersWithCost, listRequests, getProgressForRequests, getCostTrend } from '@/lib/db/research'
import { getDealCaseType } from '@/lib/db/deals'
import { caseTypeWantsProperty, isCaseType } from '@/lib/research/case-type'
import { parseAddress } from '@/lib/utils/address'
import type { PersonQuery, Goal, CaseType } from '@/lib/research/types'

const GOALS: Goal[] = ['locate_owner', 'find_heirs', 'mailing_address', 'contact', 'property_records']

// POST → enqueue a research request (returns instantly; Hermes drains the queue). Session or agent.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  let body: Partial<PersonQuery> & { goal?: string; force?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const goal: Goal = GOALS.includes(body.goal as Goal) ? (body.goal as Goal) : 'find_heirs'
  // The run's declared category (from the form); fall back to the linked deal's type for gating.
  const runCaseType: CaseType | null = isCaseType(body.caseType) ? body.caseType : null

  // A property run needs an anchor — ask for it instead of running blind. (city/state are parsed from
  // the address; only the address OR a parcel id is actually required.)
  if (goal === 'property_records') {
    const effectiveType = runCaseType ?? (body.caseId ? await getDealCaseType(body.caseId) : null)
    if (!body.force && !caseTypeWantsProperty(effectiveType)) {
      return NextResponse.json({ skipped: true, reason: 'case_type_no_property', caseType: effectiveType })
    }
    if (!body.address?.trim() && !body.parcelId?.trim()) {
      return NextResponse.json({ error: 'A property address or parcel id is required for a property search', needs: 'address' }, { status: 400 })
    }
  }

  // Conservative case-level idempotency (unless forced). A property-records run has its OWN key (recent
  // property evidence) so it isn't blocked by an existing person dossier — and vice versa.
  if (body.caseId && !body.force) {
    if (goal === 'property_records') {
      const recent = await findRecentPropertyEvidenceForCase(body.caseId)
      if (recent) return NextResponse.json({ skipped: true, reason: 'recent_property_evidence', evidencePackageId: recent.id, evidenceAt: recent.completedAt })
    } else {
      const recent = await findRecentDossierForCase(body.caseId)
      if (recent) return NextResponse.json({ skipped: true, reason: 'recent_dossier', dossierId: recent.id, dossierAt: recent.createdAt })
    }
  }

  // One "property address" field — parse city/state/zip out of it (explicit body fields override).
  const parsed = parseAddress(body.address)
  const query: PersonQuery = {
    name: body.name.trim(),
    address: parsed.full || undefined,
    city: body.city?.trim() || parsed.city || undefined,
    state: body.state?.trim() || parsed.state || 'GA',
    zip: body.zip?.trim() || parsed.zip || undefined,
    parcelId: body.parcelId?.trim() || undefined,
    county: body.county?.trim() || undefined,
    caseType: runCaseType ?? undefined,
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
