import { prisma } from './client'

export async function getContactsForDeal(hubspotId: string) {
  return prisma.dealContact.findMany({
    where: { dealHubspotId: hubspotId },
    select: {
      id: true,
      contactHubspotId: true,
      name: true,
      contactType: true,
      ownershipStatus: true,
      isDeceased: true,
      doNotContact: true,
      phoneNumbers: true,
      emailList: true,
      address: true,
      city: true,
      state: true,
      zip: true,
    },
  })
}
