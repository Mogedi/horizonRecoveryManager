import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { runSummaryGeneration } from '@/lib/ai/generate'
import { AIError } from '@/lib/ai/errors'
import { log } from '@/lib/logger'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id } = await params
  log.info('ai summary requested', { dealId: id })

  try {
    const result = await runSummaryGeneration(id)
    log.info('ai summary complete', { dealId: id })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AIError) {
      log.error('ai summary failed', { dealId: id, error: err.message })
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    throw err
  }
}
