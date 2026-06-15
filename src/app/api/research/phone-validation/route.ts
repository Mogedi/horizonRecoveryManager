import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { getRecentPhoneValidations } from '@/lib/db/research'

// Reuse-before-pay cache for phone validation. The agent calls this BEFORE paying Trestle (~$0.03/lookup)
// to skip numbers we already validated recently.
//   GET /api/research/phone-validation?numbers=+14045551234,+14045556789
//   → { validations: { "14045551234": { number, isValid, activityScore, lineType, nameMatch, ... } } }
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const raw = req.nextUrl.searchParams.get('numbers') ?? ''
  const numbers = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (!numbers.length) return NextResponse.json({ validations: {} })
  const validations = await getRecentPhoneValidations(numbers)
  return NextResponse.json({ validations })
}
