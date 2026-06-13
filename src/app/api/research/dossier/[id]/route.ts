import { NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { getDossierDetail } from '@/lib/db/research'

// Full dossier for the detail panel: derived dossier + source evidence + per-run cost.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorizedResponse()
  const { id } = await params
  const detail = await getDossierDetail(Number(id))
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(detail)
}
