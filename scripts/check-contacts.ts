import { prisma } from '@/lib/db/client'

async function main() {
  const total = await prisma.deal.count()
  const withContacts = await prisma.deal.count({ where: { contacts: { some: {} } } })
  const events = await prisma.activityEvent.count()
  const unmatched = await prisma.activityEvent.count({ where: { dealHubspotId: null } })
  const phones = await prisma.phoneNumber.count()

  const sample = await prisma.deal.findFirst({
    where: { contacts: { some: {} } },
    select: { hubspotId: true, contacts: { select: { name: true, phoneNumbers: true } } },
  })

  console.log(JSON.stringify({ total, withContacts, events, unmatched, phones }, null, 2))
  console.log('sample contacts:', JSON.stringify(sample?.contacts).slice(0, 600))

  await prisma.$disconnect()
}

main()
