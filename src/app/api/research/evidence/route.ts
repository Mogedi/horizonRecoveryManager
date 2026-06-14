import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { ingestEvidencePackage } from '@/lib/research/ingest'
import { failRequest } from '@/lib/db/research'
import { validateEvidencePackage } from '@/lib/research/schema'
import type { EvidencePackage } from '@/lib/research/types'
import { log } from '@/lib/logger'

// Hermes posts an EvidencePackage here. Horizon stores it immutably and derives the dossier.
// This is the ONLY way evidence becomes a business object — and Hermes can write nothing else.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  // Validate the contract at the boundary — malformed agent data fails fast with a clear 400 instead of
  // a confusing 500 or a silently-wrong dossier. We validate but DON'T mutate: the original raw body is
  // stored immutably ("store everything"), so unknown/future fields survive.
  const valid = validateEvidencePackage(raw)
  if (!valid.ok) {
    log.warn('evidence package failed validation', { issues: valid.issues })
    return NextResponse.json({ error: 'evidence package failed validation', issues: valid.issues }, { status: 400 })
  }
  const pkg = raw as EvidencePackage

  try {
    const { evidencePackageId, dossierId } = await ingestEvidencePackage(pkg)
    return NextResponse.json({ evidencePackageId, dossierId })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.error('evidence ingest failed', { error: message, requestId: pkg.requestId })
    if (pkg.requestId) await failRequest(pkg.requestId, message).catch(() => {})
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
