import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { ingestEvidencePackage } from '@/lib/research/ingest'
import { failRequest } from '@/lib/db/research'
import type { EvidencePackage } from '@/lib/research/types'
import { log } from '@/lib/logger'

// Hermes posts an EvidencePackage here. Horizon stores it immutably and derives the dossier.
// This is the ONLY way evidence becomes a business object — and Hermes can write nothing else.
export async function POST(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  let pkg: EvidencePackage
  try { pkg = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  if (!pkg?.query?.name) return NextResponse.json({ error: 'evidence package missing query.name' }, { status: 400 })

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
