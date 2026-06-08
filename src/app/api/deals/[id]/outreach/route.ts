import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { getDealOutreachMatrix } from '@/lib/db/outreach'

// GET /api/deals/[id]/outreach — returns the contact outreach matrix for a deal
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id } = await params

  try {
    const matrix = await getDealOutreachMatrix(id)
    return NextResponse.json(matrix)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
