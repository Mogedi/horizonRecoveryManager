import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getOpenTaskCount } from '@/lib/db/tasks'

export async function GET() {
  const cookieStore = await cookies()
  if (cookieStore.get('horizon_auth')?.value !== '1') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const count = await getOpenTaskCount()
  return NextResponse.json({ count })
}
