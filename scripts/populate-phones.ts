import { populateFromDealContacts } from '@/lib/db/phone-numbers'
import { normalizeToE164 } from '@/lib/integrations/justcall/normalize'
import { prisma } from '@/lib/db/client'

async function main() {
  console.log('Populating phone_numbers from deal_contacts...')
  const result = await populateFromDealContacts(normalizeToE164)
  console.log('populate result:', result)

  // Now check if any unmatched activity_events can be matched
  const phones = await prisma.phoneNumber.findMany({ select: { numberE164: true, dealHubspotId: true } })
  console.log(`phone_numbers table: ${phones.length} rows`)
  phones.forEach(p => console.log(' ', p.numberE164, '->', p.dealHubspotId))

  // Check the activity_events contact numbers against phone_numbers
  const events = await prisma.activityEvent.findMany({
    where: { dealHubspotId: null },
    select: { toNumber: true, fromNumber: true },
    take: 10,
  })
  console.log('\nSample unmatched events (to/from):')
  events.forEach(e => console.log(' ', e.fromNumber, '->', e.toNumber))

  await prisma.$disconnect()
}

main()
