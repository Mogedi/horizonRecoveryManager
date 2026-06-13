import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { claimNextRequest } from '@/lib/db/research'

// Hermes pulls the next pending research request (marks it running). null when the queue is empty.
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const request = await claimNextRequest()
  return NextResponse.json({ request })
}
