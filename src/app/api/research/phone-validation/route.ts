import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { decidePhoneValidations } from '@/lib/db/research'

// Pre-pay decision for phone validation. The agent calls this BEFORE paying Trestle (~$0.03/lookup);
// it bakes in the durable store + free pre-filters and returns, per number: validate | reuse | skip.
//   GET /api/research/phone-validation?name=Jane%20Doe&numbers=+14045551234,8005551234[&business=1]
//   → { decisions: [{ number, key, decision, reason, cached? }] }
// Only call Trestle for decision==='validate'; re-emit phone_validation evidence for 'reuse'; ignore 'skip'.
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const p = req.nextUrl.searchParams
  const name = p.get('name') ?? ''
  const numbers = (p.get('numbers') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const business = p.get('business') === '1' || p.get('business') === 'true'
  if (!numbers.length) return NextResponse.json({ decisions: [] })
  const decisions = await decidePhoneValidations(numbers, name, { business })
  return NextResponse.json({ decisions })
}
