import 'server-only'
import { SignJWT, jwtVerify } from 'jose'

const SESSION_COOKIE = 'horizon_session'
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecretKey())
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecretKey(), { algorithms: ['HS256'] })
    return true
  } catch {
    return false
  }
}

export { SESSION_COOKIE, SESSION_DURATION_MS }
