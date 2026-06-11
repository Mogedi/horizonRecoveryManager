import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { getTasks } from '@/lib/integrations/google/tasks'

// GET /api/google/tasks?completed=1 — tasks on the default Google Tasks list (read-only).
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  }
  const showCompleted = new URL(req.url).searchParams.get('completed') === '1'
  try {
    const tasks = await getTasks({ showCompleted })
    return NextResponse.json({ count: tasks.length, tasks })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
