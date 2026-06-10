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

export type FolderMatchMethod = 'exact' | 'normalized' | 'prefix' | 'token'

// Scores token overlap between two pre-normalized strings using the Sørensen–Dice coefficient.
// Tokens shorter than 2 chars are ignored (strips single-letter noise like "st" abbreviations
// that appear in one name but not the other).
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/[\s-]+/).filter(t => t.length > 1))
  const tb = new Set(b.split(/[\s-]+/).filter(t => t.length > 1))
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return (2 * shared) / (ta.size + tb.size)
}

// Four-tier folder matching: exact → normalized → prefix → token overlap.
// All tiers after the first run on normalized strings so callers don't need to
// pre-process inputs. Returns the first match found, or null.
export function findBestFolderMatch(
  dealName: string,
  folders: ReadonlyArray<{ id: string; name: string; webViewLink?: string }>
): { folder: { id: string; name: string; webViewLink?: string }; method: FolderMatchMethod } | null {
  if (!dealName || folders.length === 0) return null

  // Tier 1: exact string match
  const exact = folders.find(f => f.name === dealName)
  if (exact) return { folder: exact, method: 'exact' }

  const normalizedDeal = normalizeFolderName(dealName)

  // Tier 2: normalized equality (strips trailing $54K, converts dashes, lowercases)
  const norm = folders.find(f => normalizeFolderName(f.name) === normalizedDeal)
  if (norm) return { folder: norm, method: 'normalized' }

  // Tier 3: prefix/contains — folder name is a prefix of the deal name or vice versa.
  // Handles cases like deal = "CHATHAM - 2214 Hanson St - Smith - Addendum" matching
  // folder = "CHATHAM - 2214 Hanson St - Smith".
  // Length ratio guard: shorter string must be ≥ 60% of the longer to prevent a bare
  // county name ("CHATHAM") from matching a full folder name as a trivial prefix.
  const prefix = folders.find(f => {
    const nf = normalizeFolderName(f.name)
    const shorter = normalizedDeal.length < nf.length ? normalizedDeal : nf
    const longer  = normalizedDeal.length < nf.length ? nf : normalizedDeal
    if (shorter.length / longer.length < 0.6) return false
    return normalizedDeal.startsWith(nf) || nf.startsWith(normalizedDeal)
  })
  if (prefix) return { folder: prefix, method: 'prefix' }

  // Tier 4: token overlap ≥ 0.75 — handles reordered or extra tokens.
  // Threshold of 0.75 requires strong overlap to prevent false positives on
  // short names that share common words like county names alone.
  const token = folders.find(f => tokenOverlap(normalizedDeal, normalizeFolderName(f.name)) >= 0.75)
  if (token) return { folder: token, method: 'token' }

  return null
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

  // Warn on duplicate folder names — findBestFolderMatch returns first match
  const seenNames = new Set<string>()
  for (const folder of allFolders) {
    if (seenNames.has(folder.name)) {
      log.warn('drive index: duplicate folder name', { name: folder.name })
    }
    seenNames.add(folder.name)
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

    const bestMatch = findBestFolderMatch(deal.name, allFolders)
    const matchedFolder = bestMatch?.folder
    const isExact = bestMatch?.method === 'exact'

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
