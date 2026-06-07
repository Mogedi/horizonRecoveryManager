import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { runSummaryGeneration } from '@/lib/ai/generate'
import { AIError } from '@/lib/ai/errors'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id } = await params

  try {
    const result = await runSummaryGeneration(id)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AIError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    throw err
  }
}
