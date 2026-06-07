import { NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { getOpenTaskCount } from '@/lib/db/tasks'

export async function GET() {
  if (!(await isAuthenticated())) return unauthorizedResponse()
  const count = await getOpenTaskCount()
  return NextResponse.json({ count })
}
