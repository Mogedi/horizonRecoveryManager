import { NextResponse } from 'next/server'
import { getContactQualityList } from '@/lib/db/contact-quality'

export async function GET() {
  try {
    const rows = await getContactQualityList()
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[contact-quality]', err)
    return NextResponse.json({ error: 'Failed to load contact quality data' }, { status: 500 })
  }
}
