// Checks whether Google Drive files are linked to a HubSpot deal via the
// HubSpot App Store Google Drive integration.
//
// Problem: HubSpot's API does not expose App Store integration data. Files
// may exist in Google Drive but employees may skip the step of linking them
// to the HubSpot deal sidebar. This check is the only way to verify the link
// without manually opening HubSpot.
//
// Approach: screenshot the HubSpot deal page → Claude Vision reads the
// Google Drive card in the right sidebar → returns which files are visible.
//
// Required env vars:
//   HUBSPOT_PORTAL_ID        — numeric portal ID (from HubSpot settings)
//   HUBSPOT_SESSION_COOKIES  — JSON array of Playwright Cookie objects
//                              (capture from browser DevTools after logging in)

import { takeScreenshot } from '@/lib/browser/screenshot'
import { verifyScreenshot } from '@/lib/ai/vision-verify'
import { loadHubSpotCookies } from '@/lib/browser/client'
import { BrowserError } from '@/lib/errors'
import { log } from '@/lib/logger'

export type HubSpotDriveCheckResult = {
  checked: boolean         // false if portal ID or cookies not configured
  filesLinked: boolean     // true if ALL expectedFiles found in sidebar
  linkedFiles: string[]    // file names Claude found in the Google Drive sidebar
  missingFiles: string[]   // expectedFiles not visible in the sidebar
  confidence: 'high' | 'medium' | 'low'
  findings: string[]       // Claude's observations
  sessionExpired: boolean  // true if the screenshot showed a login page
  screenshotBase64: string | null
  checkedAt: string        // ISO timestamp
}

// Returns the HubSpot deal page URL for a given numeric deal ID.
function dealUrl(dealId: string): string {
  const portalId = process.env.HUBSPOT_PORTAL_ID
  if (!portalId) throw new BrowserError('HUBSPOT_PORTAL_ID env var is not set')
  return `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}`
}

export async function checkHubSpotDriveAttachments(
  hubspotId: string,
  expectedFiles: string[],
): Promise<HubSpotDriveCheckResult> {
  const portalId = process.env.HUBSPOT_PORTAL_ID
  if (!portalId) {
    log.warn('hubspot-browser: HUBSPOT_PORTAL_ID not set — skipping drive check')
    return notConfigured()
  }

  const cookies = loadHubSpotCookies()
  if (cookies.length === 0) {
    log.warn('hubspot-browser: HUBSPOT_SESSION_COOKIES not set — skipping drive check')
    return notConfigured()
  }

  const url = dealUrl(hubspotId)
  const start = Date.now()

  const { base64 } = await takeScreenshot(url, {
    cookies,
    viewport: { width: 1440, height: 900 },
    // Wait for the right sidebar to render — the Drive card lives here
    waitForSelector: '[data-test-id="crm-sidebar-right"]',
    type: 'jpeg',
    quality: 80,
  })

  log.info('hubspot-browser: screenshot captured', { hubspotId, ms: Date.now() - start })

  const result = await verifyScreenshot(base64, {
    description: 'HubSpot deal page — Google Drive sidebar card shows attached files',
    expectedItems: expectedFiles,
    extractFields: ['all file names visible in the Google Drive card on the right sidebar'],
  })

  const sessionExpired = result.findings.some(f =>
    f.toLowerCase().includes('session_expired') || f.toLowerCase().includes('login')
  )

  return {
    checked: true,
    filesLinked: result.passed && !sessionExpired,
    linkedFiles: result.extracted['all file names visible in the Google Drive card on the right sidebar']
      ?.split(/[,\n]+/)
      .map(s => s.trim())
      .filter(Boolean) ?? [],
    missingFiles: result.missingItems,
    confidence: result.confidence,
    findings: result.findings,
    sessionExpired,
    screenshotBase64: base64,
    checkedAt: new Date().toISOString(),
  }
}

function notConfigured(): HubSpotDriveCheckResult {
  return {
    checked: false,
    filesLinked: false,
    linkedFiles: [],
    missingFiles: [],
    confidence: 'low',
    findings: ['HubSpot browser check not configured — set HUBSPOT_PORTAL_ID and HUBSPOT_SESSION_COOKIES'],
    sessionExpired: false,
    screenshotBase64: null,
    checkedAt: new Date().toISOString(),
  }
}
