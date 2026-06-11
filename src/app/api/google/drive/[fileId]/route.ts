import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { readDriveDocument } from '@/lib/integrations/google/drive-read'

// Reading a PDF runs it through Claude (vision/document) — allow time.
export const maxDuration = 60

type Params = { params: Promise<{ fileId: string }> }

// GET /api/google/drive/[fileId] — extract and return a Drive document's text.
export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  const { fileId } = await params
  try {
    const r = await readDriveDocument(fileId)
    return NextResponse.json(r)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
