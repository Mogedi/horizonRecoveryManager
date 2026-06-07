import { NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { runBriefingGeneration } from '@/lib/ai/briefing'
import { AIError } from '@/lib/ai/errors'

export async function POST() {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  try {
    const briefing = await runBriefingGeneration()
    return NextResponse.json({ briefing })
  } catch (err) {
    if (err instanceof AIError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    throw err
  }
}
