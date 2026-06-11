import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { getActiveDealsWithDriveFolder } from '@/lib/db/deals'

// GET /api/deals/active-with-docs — active (non-terminal) deals that have a Drive folder.
// The Hermes weekly doc-verification job iterates this list, one hubspot-check per deal.
// Terminal/closed cases are excluded server-side (single source of truth for stage groups).
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  const deals = await getActiveDealsWithDriveFolder()
  return NextResponse.json({ count: deals.length, deals })
}
