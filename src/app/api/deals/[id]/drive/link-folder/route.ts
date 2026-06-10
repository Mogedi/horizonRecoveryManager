// POST /api/deals/[id]/drive/link-folder
//
// Manually links a Google Drive folder to a deal — used when automatic
// folder detection fails (fulltext_fallback mode).
//
// Two modes controlled by the `preview` field:
//
//   { folderId, preview: true }
//     → Fetches folder name + file count from Drive. No DB write.
//       Returns: { name, fileCount, webViewLink }
//
//   { folderId, preview: false }  (or omit preview)
//     → Fetches folder contents, writes to DB (driveFolderId, driveFilesCache, etc.)
//       Returns: { success: true, name, fileCount }

import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { getDealById, updateDealDriveCache } from '@/lib/db/deals'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { googleClient } from '@/lib/integrations/google/client'
import { mapDriveFile } from '@/lib/integrations/google/mapper'
import { log } from '@/lib/logger'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  }

  const { id } = await params

  let folderId: string
  let preview: boolean
  try {
    const body = await req.json() as { folderId?: string; preview?: boolean }
    if (!body.folderId || typeof body.folderId !== 'string') {
      return NextResponse.json({ error: 'folderId is required' }, { status: 400 })
    }
    folderId = body.folderId.trim()
    preview = body.preview ?? false
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const deal = await getDealById(id)
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  try {
    // Step 1: fetch folder metadata (name + webViewLink)
    const meta = await googleClient.getFolderMetadata(folderId)
    if (!meta) {
      return NextResponse.json(
        { error: 'Folder not found or not accessible. Check the folder ID and sharing settings.' },
        { status: 404 }
      )
    }

    // Step 2: list folder contents
    const rawFiles = await googleClient.listFolderContents(folderId)
    const files = rawFiles.map(mapDriveFile)

    if (preview) {
      // Preview mode — return folder info without writing to DB
      log.info('drive link-folder preview', { dealId: id, folderId, name: meta.name, fileCount: files.length })
      return NextResponse.json({
        name: meta.name,
        fileCount: files.length,
        webViewLink: meta.webViewLink ?? null,
      })
    }

    // Commit mode — persist to DB
    await updateDealDriveCache(id, {
      folderId,
      folderUrl: meta.webViewLink ?? null,
      folderPath: meta.name,
      filesCache: files,
    })

    log.info('drive link-folder committed', { dealId: id, folderId, name: meta.name, fileCount: files.length })
    return NextResponse.json({ success: true, name: meta.name, fileCount: files.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('drive link-folder failed', { dealId: id, folderId, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
