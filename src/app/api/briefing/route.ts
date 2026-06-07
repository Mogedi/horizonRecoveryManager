import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { runBriefingGeneration } from '@/lib/ai/briefing'
import { AIError } from '@/lib/ai/errors'

export async function POST() {
  const cookieStore = await cookies()
  if (cookieStore.get('horizon_auth')?.value !== '1') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
