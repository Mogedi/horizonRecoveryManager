import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth/session'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/login' || pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  // Vercel cron requests carry Authorization: Bearer <CRON_SECRET> but no session cookie.
  // Let them through here — the route handler verifies the secret again before acting.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader === `Bearer ${cronSecret}`) {
      return NextResponse.next()
    }
  }

  // Hermes agent requests carry Authorization: Bearer <HERMES_TOKEN> (no session cookie).
  // Same pattern — the route handler re-verifies and enforces the kill switch before writing.
  const hermesToken = process.env.HERMES_TOKEN
  if (hermesToken) {
    const authHeader = request.headers.get('authorization')
    if (authHeader === `Bearer ${hermesToken}`) {
      return NextResponse.next()
    }
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value
  if (!sessionToken || !(await verifySessionToken(sessionToken))) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/((?!auth).*)'],
}
