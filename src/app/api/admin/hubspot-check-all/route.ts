// GET /api/admin/hubspot-check-all
//
// Returns the list of deals for the bulk HubSpot screenshot check job.
// Consumed by BulkHubspotCheckPanel in the Settings page.
//
// Query params:
//   uncheckedOnly=1  — only deals not checked or checked >7 days ago (default: all deals)

import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { getDealsForBulkHubspotCheck } from '@/lib/db/deals'

export type BulkCheckDeal = {
  hubspotId: string
  name: string | null
  hasFolder: boolean      // driveFilesCache !== null — folder matched and cached
  hasScreenshot: boolean  // hubspotScreenshot exists — reanalyze path available
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const uncheckedOnly = req.nextUrl.searchParams.get('uncheckedOnly') === '1'
  const deals = await getDealsForBulkHubspotCheck(uncheckedOnly)

  const pending: BulkCheckDeal[] = deals.map(d => ({
    hubspotId: d.hubspotId,
    name: d.name,
    hasFolder: d.driveFilesCache !== null,
    hasScreenshot: d.hubspotScreenshot !== null,
  }))

  return NextResponse.json({ pending })
}
