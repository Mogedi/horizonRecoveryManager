import { prisma } from './client'
import { Prisma } from '@prisma/client'
import { withBatchTransaction } from './transaction'
import type { NormalizedDeal } from '@/lib/rules/types'
import type { MappedDeal } from '@/lib/hubspot/mapper'
import type { HubSpotDriveCheckResult, HubSpotDocStatus } from '@/lib/integrations/hubspot-browser/drive-check'

// Re-export so callers that only need the DB layer don't have to import from two places.
export type { HubSpotDocStatus }
import { asJson } from '@/lib/utils/json'
import { getPipelineGroup } from '@/lib/utils/pipeline-group'

// Active (non-terminal) deals that have an indexed Drive folder — the candidate set for the
// weekly doc-verification job. Terminal/closed cases are excluded (their docs won't change).
export async function getActiveDealsWithDriveFolder(): Promise<Array<{ hubspotId: string; name: string | null }>> {
  const rows = await prisma.deal.findMany({
    where: { driveFolderId: { not: null } },
    select: { hubspotId: true, name: true, stage: true },
  })
  return rows
    .filter(d => getPipelineGroup(d.stage) !== 'terminal')
    .map(d => ({ hubspotId: d.hubspotId, name: d.name }))
}

// Single source for all deal data consumed by the rules pipeline.
// Converts Prisma Decimal → number so rules never see Decimal objects.
// Preloads active snoozes as a Set for O(1) lookup — one query, not 150.
// Checks deal_contacts phone numbers for Layer 2 phone-check upgrade.
export async function getDealsForQueue(): Promise<{
  deals: NormalizedDeal[]
  snoozedDealIds: Set<string>
}> {
  const today = new Date()

  const [rawDeals, activeSnoozes, contactPhoneRows, callDayRows] = await Promise.all([
    prisma.deal.findMany({
      select: {
        hubspotId: true,
        name: true,
        stage: true,
        amount: true,
        stageEnteredAt: true,
        lastActivityDate: true,
        contactCount: true,
        syncedAt: true,
      },
    }),
    prisma.dealSnooze.findMany({
      where: { snoozeUntil: { gte: today }, wokeAt: null },
      select: { dealHubspotId: true },
    }),
    // One query for all Layer 2 phone data. Empty when no Layer 2 synced yet (cheap).
    prisma.dealContact.findMany({
      select: { dealHubspotId: true, phoneNumbers: true },
    }),
    // Unique call days per deal: distinct calendar days (ET) with outbound JustCall attempts.
    prisma.$queryRaw<Array<{ deal_hubspot_id: string; unique_call_days: number }>>`
      SELECT deal_hubspot_id,
        COUNT(DISTINCT (happened_at AT TIME ZONE 'America/New_York')::date)::int AS unique_call_days
      FROM activity_events
      WHERE source = 'JUSTCALL' AND direction = 'outbound'
      GROUP BY deal_hubspot_id
    `,
  ])

  // Build phone map: dealHubspotId → hasValidPhone (true if any contact has phones)
  // If a deal has no rows in deal_contacts, it won't be in this map → hasValidPhone = null
  const callDaysMap = new Map(callDayRows.map(r => [r.deal_hubspot_id, Number(r.unique_call_days)]))

  const phoneMap = new Map<string, boolean>()
  for (const c of contactPhoneRows) {
    const phones = Array.isArray(c.phoneNumbers) ? c.phoneNumbers : []
    if (!phoneMap.has(c.dealHubspotId)) phoneMap.set(c.dealHubspotId, false)
    if (phones.length > 0) phoneMap.set(c.dealHubspotId, true)
  }

  const deals: NormalizedDeal[] = rawDeals.map(d => ({
    hubspotId: d.hubspotId,
    name: d.name,
    stage: d.stage,
    amount: d.amount !== null ? Number(d.amount) : null,
    stageEnteredAt: d.stageEnteredAt,
    lastActivityDate: d.lastActivityDate,
    contactCount: d.contactCount,
    // null = no Layer 2 data for this deal; true/false = phone check result
    hasValidPhone: phoneMap.has(d.hubspotId) ? (phoneMap.get(d.hubspotId) ?? false) : null,
    syncedAt: d.syncedAt,
    uniqueCallDays: callDaysMap.get(d.hubspotId) ?? 0,
  }))

  const snoozedDealIds = new Set(activeSnoozes.map(s => s.dealHubspotId))

  return { deals, snoozedDealIds }
}

// Returns a single deal with all fields needed by the deal panel route.
export async function getDealById(hubspotId: string) {
  return prisma.deal.findUnique({
    where: { hubspotId },
    select: {
      hubspotId: true,
      name: true,
      stage: true,
      ownerId: true,
      amount: true,
      hubspotUrl: true,
      propertyAddress: true,
      county: true,
      parcelId: true,
      taxSaleDate: true,
      contactCount: true,
      lastActivityDate: true,
      stageEnteredAt: true,
      syncedAt: true,
      driveFolderId: true,
      driveFolderUrl: true,
      driveFolderPath: true,
      driveFilesCache: true,
      driveCacheUpdatedAt: true,
      docVerification: true,
      docVerificationAt: true,
      hubspotCheck: true,
      hubspotCheckAt: true,
      hubspotScreenshot: true,
      hubspotDocStatus: true,
    },
  })
}

// Upserts all deals in a single batched transaction with a 30s timeout.
// Replaces the direct prisma.$transaction call in layer1.ts.
export async function upsertDeals(deals: MappedDeal[]): Promise<void> {
  if (deals.length === 0) return

  await withBatchTransaction(
    deals.map(deal =>
      prisma.deal.upsert({
        where: { hubspotId: deal.hubspotId },
        update: {
          name: deal.name,
          stage: deal.stage,
          pipeline: deal.pipeline,
          ownerId: deal.ownerId,
          amount: deal.amount,
          estimatedSurplus: deal.estimatedSurplus,
          closeDate: deal.closeDate,
          lastActivityDate: deal.lastActivityDate,
          stageEnteredAt: deal.stageEnteredAt,
          lastModified: deal.lastModified,
          contactCount: deal.contactCount,
          propertyAddress: deal.propertyAddress,
          county: deal.county,
          parcelId: deal.parcelId,
          taxSaleDate: deal.taxSaleDate,
          hubspotUrl: deal.hubspotUrl,
          rawPayload: asJson(deal.rawPayload),
          syncedAt: new Date(),
        },
        create: {
          hubspotId: deal.hubspotId,
          name: deal.name,
          stage: deal.stage,
          pipeline: deal.pipeline,
          ownerId: deal.ownerId,
          amount: deal.amount,
          estimatedSurplus: deal.estimatedSurplus,
          closeDate: deal.closeDate,
          lastActivityDate: deal.lastActivityDate,
          stageEnteredAt: deal.stageEnteredAt,
          lastModified: deal.lastModified,
          contactCount: deal.contactCount,
          propertyAddress: deal.propertyAddress,
          county: deal.county,
          parcelId: deal.parcelId,
          taxSaleDate: deal.taxSaleDate,
          hubspotUrl: deal.hubspotUrl,
          rawPayload: asJson(deal.rawPayload),
          syncedAt: new Date(),
        },
      })
    )
  )
}

export type DriveCacheUpdate = {
  folderId: string | null
  folderUrl: string | null
  folderPath: string | null
  filesCache: unknown         // DriveFileEntry[] serialised to JSON
}

// Store the AI document verification report for a deal.
export async function updateDealDocVerification(
  hubspotId: string,
  report: unknown
): Promise<void> {
  await prisma.deal.update({
    where: { hubspotId },
    data: {
      docVerification: JSON.parse(JSON.stringify(report)),
      docVerificationAt: new Date(),
    },
  })
}

// Returns the names of all HubSpot contacts linked to a deal (for owner tracking check).
export async function getDealContactNames(hubspotId: string): Promise<string[]> {
  const rows = await prisma.dealContact.findMany({
    where: { dealHubspotId: hubspotId, name: { not: null } },
    select: { name: true },
  })
  return rows.map(r => r.name!).filter(Boolean)
}

// Returns all deals that have a Drive folder indexed but no doc verification yet.
// Includes contact names so the verify job can pass them to Claude for owner tracking.
export async function getDealsNeedingVerification(): Promise<Array<{
  hubspotId: string
  name: string | null
  driveFilesCache: unknown
  propertyAddress: string | null
  parcelId: string | null
  taxSaleDate: Date | null
  contactNames: string[]
}>> {
  const rows = await prisma.deal.findMany({
    where: {
      driveFilesCache: { not: Prisma.AnyNull },
      docVerification: { equals: Prisma.DbNull },
    },
    select: {
      hubspotId: true,
      name: true,
      driveFilesCache: true,
      propertyAddress: true,
      parcelId: true,
      taxSaleDate: true,
      contacts: { select: { name: true }, where: { name: { not: null } } },
    },
    orderBy: { name: 'asc' },
  })
  return rows.map(({ contacts, ...rest }) => ({
    ...rest,
    contactNames: contacts.map(c => c.name!).filter(Boolean),
  }))
}

// Persist a HubSpot browser screenshot check result for a deal.
// The JSON column stores everything except screenshotBase64 (stored separately to keep queries fast).
export async function updateDealHubspotCheck(
  hubspotId: string,
  check: Omit<HubSpotDriveCheckResult, 'screenshotBase64'>,
  screenshotBase64: string | null,
  // Per-doc-type status array. When provided, stored as a GIN-indexed JSONB column so
  // individual doc types can be queried: WHERE hubspot_doc_status @> '[{"type":"tax_sale_deed","linked":false}]'
  docStatuses?: HubSpotDocStatus[],
): Promise<void> {
  await prisma.deal.update({
    where: { hubspotId },
    data: {
      hubspotCheck: JSON.parse(JSON.stringify(check)) as Prisma.InputJsonValue,
      hubspotCheckAt: new Date(check.checkedAt),
      hubspotScreenshot: screenshotBase64,
      // Scalar summary columns — fast filtering/sorting without JSON extraction
      hubspotFilesLinked: check.checked ? check.filesLinked : null,
      hubspotMissingCount: check.checked ? check.missingFiles.length : null,
      // Per-type breakdown — null when not provided (e.g. fallback "all files" mode)
      hubspotDocStatus: docStatuses
        ? (JSON.parse(JSON.stringify(docStatuses)) as Prisma.InputJsonValue)
        : undefined,
    },
  })
}

// Returns all deals for the bulk HubSpot check job.
// uncheckedOnly = true: only deals not checked or checked >7 days ago.
export async function getDealsForBulkHubspotCheck(
  uncheckedOnly: boolean,
): Promise<Array<{ hubspotId: string; name: string | null; driveFilesCache: unknown; hubspotScreenshot: string | null }>> {
  return prisma.deal.findMany({
    where: uncheckedOnly ? {
      OR: [
        { hubspotCheckAt: null },
        { hubspotCheckAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    } : undefined,
    select: { hubspotId: true, name: true, driveFilesCache: true, hubspotScreenshot: true },
    orderBy: { name: 'asc' },
  })
}

// Upsert the Drive folder link + cached file list for a deal.
// Passing null folderId clears a stale match (folder deleted or renamed).
export async function updateDealDriveCache(
  hubspotId: string,
  data: DriveCacheUpdate
): Promise<void> {
  await prisma.deal.update({
    where: { hubspotId },
    data: {
      driveFolderId: data.folderId,
      driveFolderUrl: data.folderUrl,
      driveFolderPath: data.folderPath,
      driveFilesCache: data.filesCache ? JSON.parse(JSON.stringify(data.filesCache)) : null,
      driveCacheUpdatedAt: data.folderId ? new Date() : null,
    },
  })
}
