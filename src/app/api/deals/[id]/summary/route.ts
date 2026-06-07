import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { runSummaryGeneration } from '@/lib/ai/generate'
import { AIError } from '@/lib/ai/errors'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  if (cookieStore.get('horizon_auth')?.value !== '1') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
