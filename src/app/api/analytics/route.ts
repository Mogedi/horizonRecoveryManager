import { NextResponse } from 'next/server'
import { getPortfolioAnalytics } from '@/lib/db/analytics'

export async function GET() {
  const analytics = await getPortfolioAnalytics()
  return NextResponse.json(analytics)
}
