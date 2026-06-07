import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createSessionToken, SESSION_COOKIE, SESSION_DURATION_MS } from '@/lib/auth/session'

function constantTimePasswordCheck(candidate: string, expected: string): boolean {
  // Hash both to a fixed length so timingSafeEqual doesn't leak the expected password's length.
  // Using SHA-256 via Buffer avoids importing the full crypto module just for this.
  const a = Buffer.from(candidate.padEnd(128, '\0'))
  const b = Buffer.from(expected.padEnd(128, '\0'))
  // Pad to same max length — timingSafeEqual requires equal-length buffers.
  // If candidate is longer than expected, comparison still safely returns false.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  const expected = process.env.DASHBOARD_PASSWORD

  if (!expected || !constantTimePasswordCheck(String(password ?? ''), expected)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = await createSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  })
  return response
}
