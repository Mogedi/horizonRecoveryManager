import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAllEditableSettings, saveSettings } from '@/lib/db/settings'
import { getRecentSyncs } from '@/lib/db/sync-log'

async function checkAuth() {
  const cookieStore = await cookies()
  return cookieStore.get('horizon_auth')?.value === '1'
}

export async function GET() {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [settings, recentSyncs] = await Promise.all([
    getAllEditableSettings(),
    getRecentSyncs(10),
  ])

  return NextResponse.json({ settings, recentSyncs })
}

export async function PATCH(req: NextRequest) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  if (!Array.isArray(b.settings)) {
    return NextResponse.json({ error: 'settings must be an array' }, { status: 400 })
  }

  const updates = b.settings as { key: string; value: number }[]

  try {
    await saveSettings(updates)
    const settings = await getAllEditableSettings()
    return NextResponse.json({ settings })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Save failed' },
      { status: 400 }
    )
  }
}
