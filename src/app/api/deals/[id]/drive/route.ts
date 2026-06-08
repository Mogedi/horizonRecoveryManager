// Google Drive files for a specific deal.
//
// Primary path (post-indexing): serve entirely from DB cache — zero API calls.
// Fallback path (not yet indexed): live folder search + fulltext search.
// The UI shows files immediately; "stale" flag shown if cache is >24h old.

import { NextRequest, NextResponse } from 'next/server'
import { getDealById } from '@/lib/db/deals'
import { updateDealDriveCache } from '@/lib/db/deals'
import { googleClient } from '@/lib/integrations/google/client'
import { mapDriveFile } from '@/lib/integrations/google/mapper'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { normalizeFolderName, getCasesFolderIds, type DriveFileEntry } from '@/lib/integrations/google/drive-index'
import { classifyFiles, type DocChecklist } from '@/lib/integrations/google/doc-classifier'
import { log } from '@/lib/logger'

const CACHE_STALE_MS = 24 * 60 * 60 * 1000   // 24 hours

type MatchMethod = 'cached' | 'exact_folder' | 'fuzzy_folder' | 'fulltext_fallback' | 'unconfigured_fallback'

export type DriveApiResponse = {
  configured: boolean
  matchMethod: MatchMethod | null
  folderPath: string | null
  folderLink: string | null
  files: DriveFileEntry[]
  docChecklist: DocChecklist
  docVerification: unknown | null       // FullVerificationReport if previously run
  docVerificationAt: string | null
  stale: boolean              // true if cache is >24h old
  cachedAt: string | null     // ISO timestamp of last index
  warning: string | null
}

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  if (!isGoogleConfigured()) {
    return NextResponse.json({ configured: false, files: [], docChecklist: classifyFiles([]), docVerification: null, docVerificationAt: null, matchMethod: null, folderPath: null, folderLink: null, stale: false, cachedAt: null, warning: null } satisfies DriveApiResponse)
  }

  const { id } = await params

  try {
    const deal = await getDealById(id)
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

    // ── Primary path: serve from DB cache ──────────────────────────────────────
    if (deal.driveFolderId && deal.driveFilesCache !== null) {
      const cacheAge = deal.driveCacheUpdatedAt
        ? Date.now() - deal.driveCacheUpdatedAt.getTime()
        : Infinity
      const stale = cacheAge > CACHE_STALE_MS
      const files = deal.driveFilesCache as DriveFileEntry[]

      const result: DriveApiResponse = {
        configured: true,
        matchMethod: 'cached',
        folderPath: deal.driveFolderPath ?? null,
        folderLink: deal.driveFolderUrl ?? null,
        files,
        docChecklist: classifyFiles(files),
        docVerification: deal.docVerification ?? null,
        docVerificationAt: deal.docVerificationAt?.toISOString() ?? null,
        stale,
        cachedAt: deal.driveCacheUpdatedAt?.toISOString() ?? null,
        warning: stale
          ? `Drive files last synced ${Math.round(cacheAge / 3600000)}h ago. Re-run Drive indexing to refresh.`
          : null,
      }
      return NextResponse.json(result)
    }

    // ── Fallback: live search (not yet indexed) ────────────────────────────────
    const dealName = deal.name ?? ''
    const sharedDriveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID

    // ── Live workspace folder search ─────────────────────────────────────────
    // Search ALL folders in the shared workspace for a name match before falling
    // back to fulltext. This handles deals not yet indexed or recently moved.
    if (sharedDriveId && dealName) {
      const folder = await findFolderInWorkspace(dealName, sharedDriveId)

      if (folder) {
        const rawFiles = await googleClient.listFolderContents(folder.id)
        const files = rawFiles.map(mapDriveFile)

        // Store in DB so next open is instant from cache
        await updateDealDriveCache(id, {
          folderId: folder.id,
          folderUrl: folder.webViewLink ?? null,
          folderPath: folder.path,
          filesCache: files,
        })

        const result: DriveApiResponse = {
          configured: true,
          matchMethod: folder.matchMethod,
          folderPath: folder.path,
          folderLink: folder.webViewLink ?? null,
          files,
          docChecklist: classifyFiles(files),
          docVerification: null,
          docVerificationAt: null,
          stale: false,
          cachedAt: new Date().toISOString(),
          warning: null,
        }
        log.info('drive live workspace match', { dealId: id, matchMethod: folder.matchMethod, path: folder.path })
        return NextResponse.json(result)
      }
    }

    // ── Last resort: fulltext search ─────────────────────────────────────────
    const searchTerm = extractSearchTerm(dealName)
    if (!searchTerm) {
      return NextResponse.json({
        configured: true, matchMethod: 'fulltext_fallback', folderPath: null, folderLink: null,
        files: [], docChecklist: classifyFiles([]), docVerification: null, docVerificationAt: null, stale: false, cachedAt: null, warning: 'Deal name too short to search.',
      } satisfies DriveApiResponse)
    }

    const fallbackRes = await googleClient.searchDriveFiles(
      `fullText contains "${searchTerm}"`,
      { maxResults: 20, driveId: sharedDriveId }
    )

    const fallbackFiles = (fallbackRes.files ?? []).map(mapDriveFile)
    const result: DriveApiResponse = {
      configured: true,
      matchMethod: 'fulltext_fallback',
      folderPath: null,
      folderLink: null,
      files: fallbackFiles,
      docChecklist: classifyFiles(fallbackFiles),
      docVerification: null,
      docVerificationAt: null,
      stale: false,
      cachedAt: null,
      warning: `No folder found for this deal in Drive — showing full text search for "${searchTerm}".`,
    }
    return NextResponse.json(result)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('drive lookup failed', { dealId: id, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type FolderMatch = {
  id: string
  name: string
  webViewLink?: string
  matchMethod: 'exact_folder' | 'fuzzy_folder'
}

// Search all folders in the entire shared workspace for a deal name match.
// Lists every folder once, matches locally — no per-name API calls.
// Saves result to DB cache on match so subsequent opens are free.
async function findFolderInWorkspace(
  dealName: string,
  driveId: string
): Promise<(FolderMatch & { path: string }) | null> {
  const normalizedDealName = normalizeFolderName(dealName)

  const allFolders = await googleClient.listAllFoldersInDrive(driveId)

  // Build parent map for path construction
  const byId = new Map(allFolders.map(f => [f.id, f]))

  function buildPath(folder: typeof allFolders[0]): string {
    const parts: string[] = [folder.name]
    let parentId = folder.parents?.[0]
    const visited = new Set<string>([folder.id])
    while (parentId && byId.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = byId.get(parentId)!
      parts.unshift(parent.name)
      parentId = parent.parents?.[0]
    }
    return parts.join(' > ')
  }

  // Exact match first
  const exact = allFolders.find(f => f.name === dealName)
  if (exact) return { ...exact, matchMethod: 'exact_folder', path: buildPath(exact) }

  // Fuzzy match
  const fuzzy = allFolders.find(f => normalizeFolderName(f.name) === normalizedDealName)
  if (fuzzy) return { ...fuzzy, matchMethod: 'fuzzy_folder', path: buildPath(fuzzy) }

  return null
}

function extractSearchTerm(dealName: string): string | null {
  if (!dealName) return null
  const parts = dealName.split(/\s*[–—-]\s*/)
  const street = parts[1]?.trim()
  if (street && street.length >= 5) return street
  return dealName.slice(0, 40).trim() || null
}
