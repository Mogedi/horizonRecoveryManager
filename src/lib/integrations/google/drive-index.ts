// Drive indexing — searches the ENTIRE shared workspace for deal folders.
// Matches deal names to folder names (exact then fuzzy), builds full folder paths,
// and caches the file list per deal in the DB.
//
// After indexing, /api/deals/[id]/drive serves entirely from DB — zero API calls.
// Re-run after adding new case folders or when Drive structure changes.

import { prisma } from '@/lib/db/client'
import { updateDealDriveCache } from '@/lib/db/deals'
import { googleClient } from './client'
import type { DriveFile } from './client'
import { mapDriveFile } from './mapper'
import { log } from '@/lib/logger'

export type DriveFileEntry = {
  id: string
  name: string
  mimeType: string
  modifiedAt: string | null
  webViewLink: string | null
  iconLink: string | null
  sizeBytes: number | null
}

export type DriveIndexReport = {
  sharedDriveName: string
  foldersScanned: number       // total folders found in workspace
  dealsTotal: number
  dealsMatched: number
  dealsMatchedExact: number
  dealsMatchedFuzzy: number
  dealsUnmatched: number
  foldersUnmatched: number     // Drive folders with no deal match
  durationMs: number
}

// Strip trailing ($36K) / ($1.2M), normalize dashes, collapse whitespace, lowercase.
export function normalizeFolderName(name: string): string {
  return name
    .replace(/\(\$[\d,.KkMm]+\)\s*$/, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Parse GOOGLE_DRIVE_CASES_FOLDER_IDS — kept for the per-deal live fallback route.
// Indexing no longer uses this; it scans the entire workspace instead.
export function getCasesFolderIds(): string[] {
  const raw = process.env.GOOGLE_DRIVE_CASES_FOLDER_IDS ?? ''
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

// Build a map of folderId → full display path using the parent chain.
// e.g. "HorizonRecovery Onboarding > Georgia Cases > Gordon – 235 Whipporwill Ln..."
function buildPathMap(
  folders: DriveFile[],
  sharedDriveName: string,
  driveId: string
): Map<string, string> {
  // id → { name, parentId }
  const byId = new Map<string, { name: string; parentId: string | null }>()
  for (const f of folders) {
    const parentId = f.parents?.[0] ?? null
    byId.set(f.id, { name: f.name, parentId })
  }

  const pathCache = new Map<string, string>()

  function getPath(id: string, visited = new Set<string>()): string {
    if (pathCache.has(id)) return pathCache.get(id)!
    if (visited.has(id)) return '…'  // cycle guard
    visited.add(id)

    const node = byId.get(id)
    if (!node) {
      // Root of the shared drive — this IS the drive itself
      return sharedDriveName
    }

    const { name, parentId } = node
    if (!parentId || parentId === driveId) {
      // Direct child of the shared drive root
      const path = `${sharedDriveName} > ${name}`
      pathCache.set(id, path)
      return path
    }

    const parentPath = getPath(parentId, visited)
    const path = `${parentPath} > ${name}`
    pathCache.set(id, path)
    return path
  }

  const result = new Map<string, string>()
  for (const f of folders) {
    result.set(f.id, getPath(f.id))
  }
  return result
}

export async function indexDriveFolders(): Promise<DriveIndexReport> {
  const startMs = Date.now()

  const sharedDriveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID
  if (!sharedDriveId) {
    throw new Error('GOOGLE_DRIVE_SHARED_DRIVE_ID is not set in .env.local')
  }

  // Get shared drive display name for path building
  const sharedDriveName = await googleClient.getDriveName(sharedDriveId)
  log.info('drive index starting', { sharedDriveName, sharedDriveId })

  // Fetch ALL folders in the shared workspace in one paginated pass
  const allFolders = await googleClient.listAllFoldersInDrive(sharedDriveId)
  log.info('drive index: workspace folders fetched', { count: allFolders.length })

  // Build full-path map for every folder
  const pathMap = buildPathMap(allFolders, sharedDriveName, sharedDriveId)

  // Build lookup maps — exact name and normalized name
  const exactMap = new Map<string, DriveFile>()
  const fuzzyMap = new Map<string, DriveFile>()
  for (const folder of allFolders) {
    // Only index leaf-level folders (deal folders, not state-level like "Georgia Cases")
    // We'll match by name so duplicates just get logged as warnings
    if (exactMap.has(folder.name)) {
      log.warn('drive index: duplicate folder name', { name: folder.name })
    }
    exactMap.set(folder.name, folder)
    const normalized = normalizeFolderName(folder.name)
    if (!fuzzyMap.has(normalized)) {
      fuzzyMap.set(normalized, folder)
    }
  }

  // Load all deals
  const deals = await prisma.deal.findMany({
    select: { hubspotId: true, name: true },
  })
  log.info('drive index: deals loaded', { count: deals.length })

  let dealsMatchedExact = 0
  let dealsMatchedFuzzy = 0
  let dealsUnmatched = 0
  const matchedFolderIds = new Set<string>()

  for (const deal of deals) {
    if (!deal.name) {
      await updateDealDriveCache(deal.hubspotId, { folderId: null, folderUrl: null, folderPath: null, filesCache: null })
      dealsUnmatched++
      continue
    }

    // Tier 1: exact name match
    let matchedFolder = exactMap.get(deal.name)
    let isExact = true

    // Tier 2: normalized match
    if (!matchedFolder) {
      matchedFolder = fuzzyMap.get(normalizeFolderName(deal.name))
      isExact = false
    }

    if (matchedFolder) {
      // Fetch and cache the files in this folder
      const rawFiles = await googleClient.listFolderContents(matchedFolder.id)
      const files: DriveFileEntry[] = rawFiles.map(f => mapDriveFile(f))
      const folderPath = pathMap.get(matchedFolder.id) ?? sharedDriveName

      await updateDealDriveCache(deal.hubspotId, {
        folderId: matchedFolder.id,
        folderUrl: matchedFolder.webViewLink ?? null,
        folderPath,
        filesCache: files,
      })

      matchedFolderIds.add(matchedFolder.id)
      if (isExact) dealsMatchedExact++
      else dealsMatchedFuzzy++
    } else {
      // Clear any stale folder link
      await updateDealDriveCache(deal.hubspotId, { folderId: null, folderUrl: null, folderPath: null, filesCache: null })
      dealsUnmatched++
      log.info('drive index: no folder match', { dealName: deal.name })
    }
  }

  const foldersUnmatched = allFolders.filter(f => !matchedFolderIds.has(f.id)).length

  const report: DriveIndexReport = {
    sharedDriveName,
    foldersScanned: allFolders.length,
    dealsTotal: deals.length,
    dealsMatched: dealsMatchedExact + dealsMatchedFuzzy,
    dealsMatchedExact,
    dealsMatchedFuzzy,
    dealsUnmatched,
    foldersUnmatched,
    durationMs: Date.now() - startMs,
  }

  log.info('drive index complete', report)
  return report
}
