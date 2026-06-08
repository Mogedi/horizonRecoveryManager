import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { Prisma } from '@prisma/client'
import { loadStageMap } from '@/lib/db/settings'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'

export type SearchDoc = {
  hubspotId: string
  name: string
  stageName: string
  county: string | null
  propertyAddress: string | null
  parcelId: string | null
  amount: number | null
  contactNames: string[]
  phones: string[]           // display format (E.164)
  phonesNormalized: string[] // digits only for substring phone matching
}

export async function GET() {
  if (!await isAuthenticated()) return unauthorizedResponse()

  const [deals, contacts, stageMap] = await Promise.all([
    prisma.deal.findMany({
      select: {
        hubspotId: true,
        name: true,
        stage: true,
        amount: true,
        county: true,
        propertyAddress: true,
        parcelId: true,
      },
    }),
    prisma.dealContact.findMany({
      select: { dealHubspotId: true, name: true, phoneNumbers: true },
    }),
    loadStageMap(),
  ])

  const contactsByDeal = new Map<string, { names: string[]; phones: string[] }>()
  for (const c of contacts) {
    if (!contactsByDeal.has(c.dealHubspotId)) {
      contactsByDeal.set(c.dealHubspotId, { names: [], phones: [] })
    }
    const entry = contactsByDeal.get(c.dealHubspotId)!
    if (c.name) entry.names.push(c.name)
    const phones = Array.isArray(c.phoneNumbers) ? (c.phoneNumbers as string[]) : []
    entry.phones.push(...phones)
  }

  const docs: SearchDoc[] = deals.map(d => {
    const cd = contactsByDeal.get(d.hubspotId) ?? { names: [], phones: [] }
    const uniquePhones = [...new Set(cd.phones)]
    return {
      hubspotId: d.hubspotId,
      name: d.name ?? '',
      stageName: (d.stage ? stageMap[d.stage] : null) ?? '',
      county: d.county,
      propertyAddress: d.propertyAddress,
      parcelId: d.parcelId,
      amount: d.amount !== null ? Number(d.amount as Prisma.Decimal) : null,
      contactNames: [...new Set(cd.names)],
      phones: uniquePhones,
      phonesNormalized: uniquePhones.map(p => p.replace(/\D/g, '')),
    }
  })

  return NextResponse.json(docs)
}
